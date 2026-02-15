const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
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
    const { trainingClass, startDate, endDate, hoursLogged } = req.body;
    
    if (!req.file) {
      return res.redirect('/training/submit?error=Certificate file is required');
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
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