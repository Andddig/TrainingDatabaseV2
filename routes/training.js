// Roles allowed to manage certificates
const certificateManagerRoles = ['Training Officer', 'Approver'];
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');

const uploadsDir = path.join(__dirname, '../public/uploads');

// Import models
const TrainingClass = require('../models/TrainingClass');
const TrainingSubmission = require('../models/TrainingSubmission');
const User = mongoose.model('User');
const qualificationsModule = require('./qualifications');

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Role-based middleware
const hasRole = (roles) => {
  return (req, res, next) => {
    if (req.isAuthenticated() && (
      req.user.isAdmin || 
      roles.some(role => req.user.roles && req.user.roles.includes(role))
    )) {
      return next();
    }
    res.status(403).render('error', { 
      message: 'Access denied. You do not have the required role.'
    });
  };
};

const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) {
    return next();
  }
  res.status(403).render('error', {
    message: 'Access denied. Admin privileges required.'
  });
};

const ALLOWED_ROLES = ['Student', 'Approver', 'Training Officer'];

const normalizeRoles = (roles) => {
  const roleList = Array.isArray(roles) ? roles : (roles ? [roles] : ['Student']);
  const filtered = roleList
    .map(role => role.trim())
    .filter(role => ALLOWED_ROLES.includes(role));
  return filtered.length ? filtered : ['Student'];
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Specific role middlewares
const isApprover = (req, res, next) => {
  if (req.isAuthenticated() && (req.user.isAdmin || req.user.roles.includes('Approver'))) {
    return next();
  }
  res.status(403).render('error', { 
    message: 'Access denied. Approver privileges required.'
  });
};

const isTrainingOfficer = (req, res, next) => {
  if (req.isAuthenticated() && (req.user.isAdmin || req.user.roles.includes('Training Officer'))) {
    return next();
  }
  res.status(403).render('error', { 
    message: 'Access denied. Training Officer privileges required.'
  });
};

const canReviewSubmissions = (currentUser) => {
  if (!currentUser) {
    return false;
  }
  return currentUser.isAdmin ||
    (currentUser.roles && (
      currentUser.roles.includes('Approver') ||
      currentUser.roles.includes('Training Officer')
    ));
};

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'certificate-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images and PDFs
  const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (validTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG and PDF files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage, 
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const uploadCertificate = (req, res, next) => {
  upload.single('certificateFile')(req, res, (err) => {
    if (!err) {
      return next();
    }

    const message = err.message || 'File upload failed';
    return res.redirect('/training/submit?error=' + encodeURIComponent(message));
  });
};

const uploadCertificateForAdmin = (req, res, next) => {
  upload.single('certificateFile')(req, res, (err) => {
    if (!err) {
      return next();
    }

    const message = err.message || 'File upload failed';
    return res.redirect(`/training/admin/members?selectedUser=${req.params.id}&error=${encodeURIComponent(message)}`);
  });
};

// STUDENT ROUTES

// Show submission form
router.get('/submit', isAuthenticated, async (req, res) => {
  try {
    const trainingClasses = await TrainingClass.find({ isActive: true }).sort('name');
    const selectedClassId = req.query.class;
    
    res.render('training-submission', { 
      user: req.user, 
      trainingClasses,
      selectedClassId,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching training classes:', err);
    res.status(500).render('error', { message: 'Error loading submission form' });
  }
});

// Handle submission
router.post('/submit', isAuthenticated, uploadCertificate, async (req, res) => {
  try {
    const { trainingClass, startDate, endDate, hoursLogged, courseNumber } = req.body;
    
    if (!req.file) {
      return res.redirect('/training/submit?error=Certificate file is required');
    }

    // Validate dates
    const start = parseDateAsLocal(startDate);
    const end = parseDateAsLocal(endDate);
    if (end < start) {
      // Delete uploaded file if there's an error
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
      return res.redirect('/training/submit?error=End date cannot be earlier than start date');
    }
    
    // Create new submission
    const submission = new TrainingSubmission({
      student: req.user._id,
      trainingClass,
      startDate,
      endDate,
      hoursLogged,
      createdByAdmin: null,
      uploadedForUser: null,
      certificateFile: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        mimeType: req.file.mimetype
      }
    });
    
    await submission.save();
    res.redirect('/training/submit?success=Your training submission has been received and is pending review');
    
  } catch (err) {
    console.error('Error submitting training:', err);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
    }
    
    res.redirect('/training/submit?error=An error occurred while submitting your training');
  }
});

// View student's submissions
router.get('/my-submissions', isAuthenticated, async (req, res) => {
  try {
    const submissions = await TrainingSubmission.find({ student: req.user._id })
      .populate('trainingClass')
      .sort('-createdAt');
      
    res.render('my-submissions', { 
      user: req.user, 
      submissions,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).render('error', { message: 'Error loading your submissions' });
  }
});

router.get('/admin/members', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const searchTerm = (req.query.q || '').trim();
    const selectedUserId = req.query.selectedUser;

    const userQuery = {};
    if (searchTerm) {
      const safePattern = new RegExp(escapeRegex(searchTerm), 'i');
      userQuery.$or = [
        { displayName: safePattern },
        { firstName: safePattern },
        { lastName: safePattern },
        { email: safePattern }
      ];
    }

    const users = await User.find(userQuery).sort('displayName').limit(200);
    const trainingClasses = await TrainingClass.find({ isActive: true }).sort('name');

    let selectedUser = null;
    let selectedUserSubmissions = [];
    if (selectedUserId && mongoose.Types.ObjectId.isValid(selectedUserId)) {
      selectedUser = await User.findById(selectedUserId);
      if (selectedUser) {
        selectedUserSubmissions = await TrainingSubmission.find({ student: selectedUser._id })
          .populate('trainingClass')
          .populate('approvedBy', 'displayName')
          .populate('createdByAdmin', 'displayName')
          .sort('-createdAt')
          .limit(100);
      }
    }

    res.render('admin-member-management', {
      user: req.user,
      users,
      selectedUser,
      selectedUserSubmissions,
      trainingClasses,
      searchTerm,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error loading admin member management:', err);
    res.status(500).render('error', { message: 'Error loading member management' });
  }
});

router.post('/admin/members/:id/upload-certificate', isAuthenticated, isAdmin, uploadCertificateForAdmin, async (req, res) => {
  try {
    const selectedUserId = req.params.id;
    const userToSubmitFor = await User.findById(selectedUserId);
    if (!userToSubmitFor) {
      return res.redirect('/training/admin/members?error=User not found');
    }

    const { trainingClass, startDate, endDate, hoursLogged, adminComment } = req.body;

    if (!req.file) {
      return res.redirect(`/training/admin/members?selectedUser=${selectedUserId}&error=Certificate file is required`);
    }

    const classRecord = await TrainingClass.findById(trainingClass);
    if (!classRecord) {
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
      return res.redirect(`/training/admin/members?selectedUser=${selectedUserId}&error=Training class not found`);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
      return res.redirect(`/training/admin/members?selectedUser=${selectedUserId}&error=Please provide a valid date range`);
    }

    const parsedHours = Number(hoursLogged);
    if (!Number.isFinite(parsedHours) || parsedHours < 0) {
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
      return res.redirect(`/training/admin/members?selectedUser=${selectedUserId}&error=Hours must be 0 or greater`);
    }

    const submission = new TrainingSubmission({
      student: userToSubmitFor._id,
      trainingClass,
      startDate,
      endDate,
      hoursLogged: parsedHours,
      createdByAdmin: req.user._id,
      uploadedForUser: userToSubmitFor._id,
      certificateFile: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        mimeType: req.file.mimetype
      },
      status: 'approved',
      approvedBy: req.user._id,
      approvedAt: new Date(),
      comments: [{
        author: req.user._id,
        text: (adminComment || '').trim() || `Uploaded by admin ${req.user.displayName} on behalf of ${userToSubmitFor.displayName}`
      }]
    });

    await submission.save();

    try {
      await qualificationsModule.updateUserQualificationsForApprovedSubmission(submission);
    } catch (qualificationErr) {
      console.error('Error updating qualifications for admin-uploaded submission:', qualificationErr);
    }

    res.redirect(`/training/admin/members?selectedUser=${selectedUserId}&success=Certificate uploaded and recorded for ${encodeURIComponent(userToSubmitFor.displayName)}`);
  } catch (err) {
    console.error('Error uploading certificate for member:', err);
    if (req.file) {
      fs.unlinkSync(path.join('public/uploads/', req.file.filename));
    }
    res.redirect(`/training/admin/members?selectedUser=${req.params.id}&error=${encodeURIComponent(err.message || 'Error uploading certificate')}`);
  }
});

// ADMIN/TRAINING OFFICER ROUTES

// Manage classes
router.get('/manage-classes', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const trainingClasses = await TrainingClass.find()
      .populate('createdBy', 'displayName')
      .populate('prerequisites', 'name')
      .sort('name');
    
    res.render('manage-classes', { 
      user: req.user, 
      trainingClasses,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching training classes:', err);
    res.status(500).render('error', { message: 'Error loading training classes' });
  }
});

// Approver dashboard
router.get('/approver/dashboard', isAuthenticated, hasRole(['Approver', 'Training Officer']), async (req, res) => {
  try {
    const filter = {
      status: req.query.status || 'pending'
    };
    
    const query = filter.status === 'all' ? {} : { status: filter.status };
    
    const submissions = await TrainingSubmission.find(query)
      .populate('student')
      .populate('trainingClass')
      .sort('-createdAt');
      
    res.render('approver-dashboard', { 
      user: req.user, 
      submissions,
      filter,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching submissions for approval:', err);
    res.status(500).render('error', { message: 'Error loading approver dashboard' });
  }
});

// Certificate management dashboard for training officers and approvers
router.get('/manage-certificates', isAuthenticated, hasRole(certificateManagerRoles), async (req, res) => {
  try {
    const trainingClasses = await TrainingClass.find({ isActive: true }).sort('name');
    let selectedUser = null;

    if (req.query.selected && mongoose.Types.ObjectId.isValid(req.query.selected)) {
      selectedUser = await User.findById(req.query.selected).select('displayName email roles firstName middleName lastName');
    }

    res.render('manage-certificates', {
      user: req.user,
      trainingClasses,
      selectedUser,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error loading certificate management page:', err);
    res.status(500).render('error', { message: 'Error loading certificate management page' });
  }
});

// Fast user search endpoint for certificate management
router.get('/users/search', isAuthenticated, hasRole(certificateManagerRoles), async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.json([]);
    }

    const regex = new RegExp(escapeRegex(query), 'i');
    const users = await User.find({
      $or: [
        { displayName: regex },
        { email: regex },
        { firstName: regex },
        { lastName: regex },
        { middleName: regex }
      ]
    })
      .sort('displayName')
      .limit(10)
      .select('displayName email roles firstName middleName lastName');

    res.json(users.map(user => ({
      id: user._id,
      displayName: user.displayName,
      email: user.email,
      roles: user.roles,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName
    })));
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: 'Error searching users' });
  }
});

// Fetch a user's existing training submissions (certificates)
router.get('/users/:id/submissions', isAuthenticated, hasRole(certificateManagerRoles), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.json([]);
    }

    const submissions = await TrainingSubmission.find({ student: req.params.id })
      .populate('trainingClass')
      .sort({ approvedAt: -1, createdAt: -1 });

    const response = submissions.map(submission => ({
      id: submission._id,
      trainingClassId: submission.trainingClass ? submission.trainingClass._id : null,
      trainingClassName: submission.trainingClass ? submission.trainingClass.name : 'Class Removed',
      startDate: submission.startDate ? submission.startDate.toISOString() : null,
      endDate: submission.endDate ? submission.endDate.toISOString() : null,
      hoursLogged: submission.hoursLogged,
      courseNumber: submission.courseNumber || null,
      status: submission.status,
      approvedAt: submission.approvedAt ? submission.approvedAt.toISOString() : null,
      certificateUrl: submission.certificateFile && submission.certificateFile.filename ? `/uploads/${submission.certificateFile.filename}` : null,
      certificateOriginalName: submission.certificateFile ? submission.certificateFile.originalName : null
    }));

    res.json(response);
  } catch (err) {
    console.error('Error fetching user submissions:', err);
    res.status(500).json({ error: 'Error fetching user submissions' });
  }
});

// Attempt to extract certificate details for auto-fill
router.post('/certificates/extract', isAuthenticated, hasRole(certificateManagerRoles), (req, res) => {
  extractionUpload.single('certificateFile')(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('Certificate extraction upload error:', uploadErr);
      return res.status(400).json({
        success: false,
        error: uploadErr.message || 'Invalid certificate file.'
      });
    }

    try {
      if (!req.file) {
        throw new Error('Certificate file is required.');
      }

      const text = await extractCertificateText(req.file);
      const parsed = parseCertificateFields(text);
      const { rawText, ...extracted } = parsed;

      res.json({
        success: true,
        text: rawText || '',
        extracted
      });
    } catch (error) {
      console.error('Error extracting certificate data:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Unable to extract certificate details.'
      });
    }
  });
});

// Add a certificate on behalf of a user (auto-approves submission)
router.post('/certificates/add',
  isAuthenticated,
  hasRole(certificateManagerRoles),
  upload.single('certificateFile'),
  async (req, res) => {
    const { studentId, trainingClass, startDate, endDate, hoursLogged, courseNumber } = req.body;

    try {
      if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
        throw new Error('A valid user must be selected.');
      }

      if (!trainingClass || !mongoose.Types.ObjectId.isValid(trainingClass)) {
        throw new Error('A valid training class must be selected.');
      }

      if (!req.file) {
        throw new Error('A certificate file is required.');
      }

      const student = await User.findById(studentId).select('_id');
      if (!student) {
        throw new Error('Selected user could not be found.');
      }

      const classRecord = await TrainingClass.findById(trainingClass).select('_id');
      if (!classRecord) {
        throw new Error('Selected training class could not be found.');
      }

      const start = parseDateAsLocal(startDate);
      const end = parseDateAsLocal(endDate);
      if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Start and end dates are required.');
      }

      if (end < start) {
        throw new Error('End date cannot be earlier than start date.');
      }

      const hours = parseFloat(hoursLogged);
      if (Number.isNaN(hours) || hours < 0) {
        throw new Error('Hours completed must be a non-negative number.');
      }

      const submission = new TrainingSubmission({
        student: studentId,
        trainingClass,
        startDate: start,
        endDate: end,
        hoursLogged: hours,
        courseNumber: (courseNumber || '').trim(),
        certificateFile: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: req.file.path,
          mimeType: req.file.mimetype,
          uploadDate: new Date()
        },
        status: 'approved',
        approvedBy: req.user._id,
        approvedAt: new Date()
      });

      await submission.save();
      await qualificationsModule.updateUserQualificationsForApprovedSubmission(submission);

      const successMessage = encodeURIComponent('Certificate uploaded and auto-approved successfully');
      return res.redirect(`/training/manage-certificates?success=${successMessage}&selected=${studentId}`);
    } catch (err) {
      console.error('Error adding certificate for user:', err);
      if (req.file) {
        await deleteFileIfExists(req.file.filename);
      }
      const errorMessage = encodeURIComponent(err.message || 'Error adding certificate');
      const redirectTarget = studentId && mongoose.Types.ObjectId.isValid(studentId)
        ? `&selected=${studentId}`
        : '';
      return res.redirect(`/training/manage-certificates?error=${errorMessage}${redirectTarget}`);
    }
  });

// Update an existing submission (certificate)
router.post('/submission/:id/update',
  isAuthenticated,
  hasRole(certificateManagerRoles),
  upload.single('certificateFile'),
  async (req, res) => {
    const { trainingClass, startDate, endDate, hoursLogged, courseNumber, redirectStudentId } = req.body;
    const redirectTarget = redirectStudentId && mongoose.Types.ObjectId.isValid(redirectStudentId)
      ? redirectStudentId
      : null;

    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        throw new Error('Invalid submission identifier.');
      }

      const submission = await TrainingSubmission.findById(req.params.id);
      if (!submission) {
        throw new Error('Submission not found.');
      }

      if (!trainingClass || !mongoose.Types.ObjectId.isValid(trainingClass)) {
        throw new Error('A valid training class must be selected.');
      }

      const classRecord = await TrainingClass.findById(trainingClass).select('_id');
      if (!classRecord) {
        throw new Error('Selected training class could not be found.');
      }

      const start = parseDateAsLocal(startDate);
      const end = parseDateAsLocal(endDate);
      if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Start and end dates are required.');
      }

      if (end < start) {
        throw new Error('End date cannot be earlier than start date.');
      }

      const hours = parseFloat(hoursLogged);
      if (Number.isNaN(hours) || hours < 0) {
        throw new Error('Hours completed must be a non-negative number.');
      }

      submission.trainingClass = trainingClass;
      submission.startDate = start;
      submission.endDate = end;
      submission.hoursLogged = hours;
      submission.courseNumber = (courseNumber || '').trim();
      submission.status = 'approved';
      submission.approvedBy = req.user._id;
      submission.approvedAt = new Date();

      let previousFilename = null;
      if (req.file) {
        previousFilename = submission.certificateFile && submission.certificateFile.filename
          ? submission.certificateFile.filename
          : null;
        submission.certificateFile = {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: req.file.path,
          mimeType: req.file.mimetype,
          uploadDate: new Date()
        };
      }

      await submission.save();

      if (req.file && previousFilename && previousFilename !== submission.certificateFile.filename) {
        await deleteFileIfExists(previousFilename);
      }
      await qualificationsModule.recalculateUserQualifications(submission.student);

      const successMessage = encodeURIComponent('Certificate updated successfully');
      const selectedParam = redirectTarget || submission.student.toString();
      return res.redirect(`/training/manage-certificates?success=${successMessage}&selected=${selectedParam}`);
    } catch (err) {
      console.error('Error updating certificate:', err);
      if (req.file) {
        await deleteFileIfExists(req.file.filename);
      }
      const errorMessage = encodeURIComponent(err.message || 'Error updating certificate');
      const selectedParam = redirectTarget ? `&selected=${redirectTarget}` : '';
      return res.redirect(`/training/manage-certificates?error=${errorMessage}${selectedParam}`);
    }
  });

// View submission details
router.get('/submission/:id', isAuthenticated, async (req, res) => {
  try {
    const submission = await TrainingSubmission.findById(req.params.id)
      .populate('student')
      .populate('trainingClass')
      .populate('approvedBy')
      .populate('createdByAdmin')
      .populate('uploadedForUser')
      .populate({
        path: 'comments.author',
        model: 'User'
      });
    
    if (!submission) {
      return res.status(404).render('error', { message: 'Submission not found' });
    }
    
    // Check if user is allowed to view this submission
    const isOwner = submission.student._id.toString() === req.user._id.toString();
    if (!isOwner && !canReviewSubmissions(req.user)) {
      return res.status(403).render('error', { message: 'Access denied to this submission' });
    }
    
    res.render('submission-detail', { 
      user: req.user, 
      submission,
      canManageCertificates: req.user.isAdmin || hasManagementRole,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching submission details:', err);
    res.status(500).render('error', { message: 'Error loading submission details' });
  }
});

// Approve submission
router.post('/submission/:id/approve', isAuthenticated, isApprover, async (req, res) => {
  try {
    const submission = await TrainingSubmission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).render('error', { message: 'Submission not found' });
    }
    
    if (submission.status !== 'pending') {
      return res.redirect(`/training/submission/${submission._id}?error=This submission has already been processed`);
    }
    
    submission.status = 'approved';
    submission.approvedBy = req.user._id;
    submission.approvedAt = new Date();
    
    // Add comment if provided
    if (req.body.comment && req.body.comment.trim() !== '') {
      submission.comments.push({
        author: req.user._id,
        text: req.body.comment.trim()
      });
    }
    
    await submission.save();
    
    // Update qualifications immediately
    try {
      await qualificationsModule.updateUserQualificationsForApprovedSubmission(submission);
      console.log(`Qualifications updated for submission ${submission._id}`);
    } catch (err) {
      console.error('Error updating qualifications:', err);
    }
    
    res.redirect(`/training/submission/${submission._id}?success=Submission has been approved`);
    
  } catch (err) {
    console.error('Error approving submission:', err);
    res.redirect(`/training/submission/${req.params.id}?error=` + encodeURIComponent(err.message || 'Error approving submission'));
  }
});

// Reject submission
router.post('/submission/:id/reject', isAuthenticated, isApprover, async (req, res) => {
  try {
    const submission = await TrainingSubmission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).render('error', { message: 'Submission not found' });
    }
    
    if (submission.status !== 'pending') {
      return res.redirect(`/training/submission/${submission._id}?error=This submission has already been processed`);
    }
    
    if (!req.body.comment || req.body.comment.trim() === '') {
      return res.redirect(`/training/submission/${submission._id}?error=A reason is required when rejecting a submission`);
    }
    
    submission.status = 'rejected';
    submission.approvedBy = req.user._id;
    submission.approvedAt = new Date();
    
    // Add rejection comment
    submission.comments.push({
      author: req.user._id,
      text: req.body.comment.trim()
    });
    
    await submission.save();
    res.redirect(`/training/submission/${submission._id}?success=Submission has been rejected`);
    
  } catch (err) {
    console.error('Error rejecting submission:', err);
    res.status(500).render('error', { message: 'Error processing submission rejection' });
  }
});

// Add comment to submission
router.post('/submission/:id/comment', isAuthenticated, async (req, res) => {
  try {
    const submission = await TrainingSubmission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).render('error', { message: 'Submission not found' });
    }
    
    // Check if user is allowed to comment
    const isOwner = submission.student.toString() === req.user._id.toString();
    if (!isOwner && !canReviewSubmissions(req.user)) {
      return res.status(403).render('error', { message: 'Access denied to this submission' });
    }
    
    if (!req.body.comment || req.body.comment.trim() === '') {
      return res.redirect(`/training/submission/${submission._id}?error=Comment cannot be empty`);
    }
    
    submission.comments.push({
      author: req.user._id,
      text: req.body.comment.trim()
    });
    
    await submission.save();
    res.redirect(`/training/submission/${submission._id}?success=Comment added`);
    
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).render('error', { message: 'Error adding comment' });
  }
});

// TRAINING CLASS MANAGEMENT ROUTES

// Add new training class
router.post('/class/add', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const { name, description, hoursValue, prerequisites } = req.body;
    
    if (!name || name.trim() === '') {
      return res.redirect('/training/manage-classes?error=Class name is required');
    }
    
    // Check if class with same name already exists
    const existingClass = await TrainingClass.findOne({ name: name.trim() });
    if (existingClass) {
      return res.redirect('/training/manage-classes?error=A class with this name already exists');
    }
    
    const trainingClass = new TrainingClass({
      name: name.trim(),
      description: description ? description.trim() : '',
      hoursValue: hoursValue || 0,
      prerequisites: prerequisites ? (Array.isArray(prerequisites) ? prerequisites : [prerequisites]) : [],
      createdBy: req.user._id
    });
    
    await trainingClass.save();
    res.redirect('/training/manage-classes?success=Training class added successfully');
    
  } catch (err) {
    console.error('Error adding training class:', err);
    res.status(500).render('error', { message: 'Error adding training class' });
  }
});

// Toggle class active status
router.post('/class/:id/toggle', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const trainingClass = await TrainingClass.findById(req.params.id);
    
    if (!trainingClass) {
      return res.status(404).render('error', { message: 'Training class not found' });
    }
    
    trainingClass.isActive = !trainingClass.isActive;
    await trainingClass.save();
    
    const statusText = trainingClass.isActive ? 'activated' : 'deactivated';
    res.redirect(`/training/manage-classes?success=Training class ${statusText} successfully`);
    
  } catch (err) {
    console.error('Error toggling class status:', err);
    res.status(500).render('error', { message: 'Error updating training class' });
  }
});

// Edit training class form
router.get('/class/:id/edit', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const trainingClass = await TrainingClass.findById(req.params.id)
      .populate('prerequisites');
    
    if (!trainingClass) {
      return res.status(404).render('error', { message: 'Training class not found' });
    }
    
    // Get all other classes to select as prerequisites
    const otherClasses = await TrainingClass.find({
      _id: { $ne: trainingClass._id }
    }).sort('name');
    
    res.render('edit-class', { 
      user: req.user, 
      trainingClass,
      otherClasses,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching training class for edit:', err);
    res.status(500).render('error', { message: 'Error loading training class' });
  }
});

// Update training class
router.post('/class/:id/update', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const { name, description, hoursValue, prerequisites } = req.body;
    
    if (!name || name.trim() === '') {
      return res.redirect(`/training/class/${req.params.id}/edit?error=Class name is required`);
    }
    
    const trainingClass = await TrainingClass.findById(req.params.id);
    
    if (!trainingClass) {
      return res.status(404).render('error', { message: 'Training class not found' });
    }
    
    // Check if name is being changed and already exists
    if (name.trim() !== trainingClass.name) {
      const existingClass = await TrainingClass.findOne({ name: name.trim() });
      if (existingClass && existingClass._id.toString() !== trainingClass._id.toString()) {
        return res.redirect(`/training/class/${req.params.id}/edit?error=A class with this name already exists`);
      }
    }
    
    // Check for circular prerequisites (this class can't be a prerequisite of itself or any of its prerequisites)
    if (prerequisites) {
      const prereqSet = new Set(Array.isArray(prerequisites) ? prerequisites : [prerequisites]);
      if (prereqSet.has(trainingClass._id.toString())) {
        return res.redirect(`/training/class/${req.params.id}/edit?error=A class cannot be a prerequisite of itself`);
      }
      
      // More complex circular reference check could be added here if needed
    }
    
    trainingClass.name = name.trim();
    trainingClass.description = description ? description.trim() : '';
    trainingClass.hoursValue = hoursValue || 0;
    trainingClass.prerequisites = prerequisites ? (Array.isArray(prerequisites) ? prerequisites : [prerequisites]) : [];
    
    await trainingClass.save();
    res.redirect(`/training/manage-classes?success=Training class updated successfully`);
    
  } catch (err) {
    console.error('Error updating training class:', err);
    res.status(500).render('error', { message: 'Error updating training class' });
  }
});

module.exports = router; 