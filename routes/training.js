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

const ALLOWED_ROLES = ['Student', 'Approver', 'Training Officer', 'Rescue Officer', 'Evaluator', 'Rescue Chief'];

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

const extractionUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }
});

const toSafeNumber = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDateAsLocal = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const date = new Date(year, month, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const deleteFileIfExists = async (filename) => {
  if (!filename) {
    return;
  }

  const fullPath = path.join(uploadsDir, filename);
  try {
    await fsPromises.access(fullPath, fs.constants.F_OK);
    await fsPromises.unlink(fullPath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('Unable to delete file:', fullPath, err.message);
    }
  }
};

const normalizeWhitespace = (text) => (text || '').replace(/\s+/g, ' ').trim();

const toSingleLine = (text) => normalizeWhitespace((text || '').replace(/[\r\n]+/g, ' '));

const cleanupName = (value) => {
  if (!value) {
    return null;
  }

  let cleaned = toSingleLine(value)
    .replace(/\b(has\s+passed|successfully\s+completed|completed\s+all\s+course\s+work)\b.*$/i, '')
    .replace(/[^A-Za-z'.,\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/[.,\-\s]+$/, '').trim();
  if (!cleaned) {
    return null;
  }

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) {
    return null;
  }

  return cleaned;
};

const tryParseDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const normalized = value.replace(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/, '$1/$2/$3');
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const parseCertificateFields = (rawText) => {
  const text = typeof rawText === 'string' ? rawText : '';
  const multiline = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = multiline
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const compact = toSingleLine(multiline);

  const extracted = {
    rawText: text,
    recipientName: null,
    trainingClassName: null,
    hoursLogged: null,
    courseIdentifier: null,
    logNumber: null,
    courseDate: null,
    courseDateText: null,
    isLikelyMfri: false
  };

  if (!compact) {
    return extracted;
  }

  const awardLineIdx = lines.findIndex((line) => /\b(awarded\s+to|this\s+certificate\s+awarded\s+to)\b/i.test(line));
  if (awardLineIdx >= 0) {
    for (let i = awardLineIdx + 1; i < Math.min(awardLineIdx + 4, lines.length); i += 1) {
      if (/\b(has\s+passed|completed\s+all\s+course\s+work|course\s+work)\b/i.test(lines[i])) {
        break;
      }
      const candidateName = cleanupName(lines[i]);
      if (candidateName) {
        extracted.recipientName = candidateName;
        break;
      }
    }
  }

  if (!extracted.recipientName) {
    const blockRecipient = multiline.match(/awarded\s+to\s*\n+([\s\S]{0,120}?)\n+has\s+passed/i);
    if (blockRecipient && blockRecipient[1]) {
      extracted.recipientName = cleanupName(blockRecipient[1]);
    }
  }

  const recipientPatterns = [
    /(?:awarded|presented|issued|granted)\s+to\s*[:\-]?\s*([A-Z][A-Za-z'.,\-\s]{2,80})/i,
    /(?:participant|student|member|recipient|name)\s*[:\-]\s*([A-Z][A-Za-z'.,\-\s]{2,80})/i,
    /this certifies that\s+([A-Z][A-Za-z'.,\-\s]{2,80})/i,
    /completed by\s*[:\-]?\s*([A-Z][A-Za-z'.,\-\s]{2,80})/i
  ];

  if (!extracted.recipientName) {
    for (const pattern of recipientPatterns) {
      const match = compact.match(pattern);
      if (match && match[1]) {
        extracted.recipientName = cleanupName(match[1]);
        if (extracted.recipientName) {
          break;
        }
      }
    }
  }

  const courseWorkLineIdx = lines.findIndex((line) => /\bcompleted\s+all\s+course\s+work\s+in\b/i.test(line));
  if (courseWorkLineIdx >= 0) {
    const classParts = [];
    for (let i = courseWorkLineIdx + 1; i < Math.min(courseWorkLineIdx + 6, lines.length); i += 1) {
      const candidateLine = lines[i];
      if (/\(\s*\d+(?:\.\d+)?\s*hours?\s*\)/i.test(candidateLine)) {
        break;
      }
      if (/\b(log\s+number|date|location|director)\b/i.test(candidateLine)) {
        break;
      }
      if (/^[A-Z]{2,6}-\d{2,4}-[A-Z0-9]{2,8}-\d{4}\b/i.test(candidateLine)) {
        break;
      }
      classParts.push(candidateLine);
    }

    if (classParts.length) {
      extracted.trainingClassName = toSingleLine(classParts.join(' '));
    }
  }

  if (!extracted.trainingClassName) {
    const classBlock = multiline.match(/completed\s+all\s+course\s+work\s+in\s*\n+([\s\S]{0,180}?)\n+\(?\s*\d+(?:\.\d+)?\s*hours?\s*\)?/i);
    if (classBlock && classBlock[1]) {
      extracted.trainingClassName = toSingleLine(classBlock[1]);
    }
  }

  const classPatterns = [
    /(?:course|class|training|program)\s*(?:title|name)?\s*[:\-]\s*([^\n]{3,120})/i,
    /has successfully completed\s+([^\n]{3,120})/i,
    /successful completion of\s+([^\n]{3,120})/i,
    /successfully completed\s+([^\n]{3,120})/i
  ];

  if (!extracted.trainingClassName) {
    for (const pattern of classPatterns) {
      const match = compact.match(pattern);
      if (match && match[1]) {
        const candidate = normalizeWhitespace(match[1]).replace(/\s+(on|dated?)\s+.*$/i, '').trim();
        if (candidate && !/^\d/.test(candidate)) {
          extracted.trainingClassName = candidate;
          break;
        }
      }
    }
  }

  const hoursPatterns = [
    /total\s*(?:training\s*)?hours?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:clock\s*)?(?:hours?|hrs?)\b/i,
    /hours\s*completed\s*[:\-]?\s*(\d+(?:\.\d+)?)/i
  ];

  for (const pattern of hoursPatterns) {
    const match = compact.match(pattern);
    const hours = match && match[1] ? toSafeNumber(match[1]) : null;
    if (hours !== null) {
      extracted.hoursLogged = hours;
      break;
    }
  }

  const mfriIdDirectMatch = compact.match(/\b([A-Z]{2,6}-\d{2,4}-[A-Z0-9]{2,8}-\d{4})\b/i);
  if (mfriIdDirectMatch && mfriIdDirectMatch[1]) {
    extracted.courseIdentifier = mfriIdDirectMatch[1].toUpperCase();
  }

  const idPatterns = [
    /(?:course|class|program)\s*(?:id|number|no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-_/]{2,30})/i,
    /(?:certificate|log)\s*(?:id|number|no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-_/]{2,30})/i
  ];

  if (!extracted.courseIdentifier) {
    for (const pattern of idPatterns) {
      const match = compact.match(pattern);
      if (match && match[1]) {
        extracted.courseIdentifier = match[1].trim();
        break;
      }
    }
  }

  const logMatch = compact.match(/\blog\s*(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9\-_/]{2,30})/i);
  if (logMatch && logMatch[1]) {
    extracted.logNumber = logMatch[1].trim();
  }

  const datePatterns = [
    /(?:completion|course|class|issued?|date)\s*(?:date)?\s*[:\-]\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{2,4})/i,
    /(?:completion|course|class|issued?|date)\s*(?:date)?\s*[:\-]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /\b([A-Za-z]{3,9}\s+\d{1,2},\s+\d{2,4})\b/,
    /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/
  ];

  for (const pattern of datePatterns) {
    const match = compact.match(pattern);
    if (!match || !match[1]) {
      continue;
    }

    const parsedDate = tryParseDate(match[1]);
    if (parsedDate) {
      extracted.courseDate = parsedDate.toISOString();
      extracted.courseDateText = match[1].trim();
      break;
    }
  }

  const mfriMarkers = [
    /\bthis\s+certificate\s+awarded\s+to\b/i,
    /\bhas\s+passed\s+all\s+examinations\b/i,
    /\bcompleted\s+all\s+course\s+work\s+in\b/i,
    /\blog\s+number\b/i,
    /\b[a-z]{2,6}-\d{2,4}-[a-z0-9]{2,8}-\d{4}\b/i
  ];
  const markerHits = mfriMarkers.reduce((count, pattern) => (pattern.test(compact) ? count + 1 : count), 0);
  extracted.isLikelyMfri = markerHits >= 2;

  return extracted;
};

const extractCertificateText = async (file) => {
  if (!file) {
    throw new Error('Certificate file is required.');
  }

  const mimeType = (file.mimetype || '').toLowerCase();
  const textChunks = [];
  const buffer = file.buffer || (file.path ? await fsPromises.readFile(file.path) : null);

  if (!buffer) {
    throw new Error('Unable to read the uploaded certificate.');
  }

  if (mimeType === 'application/pdf') {
    try {
      const parsedPdf = await pdfParse(buffer);
      if (parsedPdf && parsedPdf.text) {
        textChunks.push(parsedPdf.text);
      }
    } catch (pdfErr) {
      console.warn('PDF text parse failed, falling back to OCR:', pdfErr.message);
    }
  }

  const shouldTryOcr = mimeType.startsWith('image/') || normalizeWhitespace(textChunks.join(' ')).length < 80;
  if (shouldTryOcr) {
    try {
      const ocrResult = await Tesseract.recognize(buffer, 'eng');
      const ocrText = ocrResult && ocrResult.data ? ocrResult.data.text : '';
      if (ocrText) {
        textChunks.push(ocrText);
      }
    } catch (ocrErr) {
      console.warn('OCR parse failed:', ocrErr.message);
    }
  }

  const combinedText = textChunks
    .map((chunk) => (chunk || '').toString())
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  if (!normalizeWhitespace(combinedText)) {
    throw new Error('Unable to read text from certificate. Try a clearer PDF/image.');
  }

  return combinedText;
};

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
    const canCreateTrainingClass = req.user.isAdmin || (req.user.roles && req.user.roles.includes('Training Officer'));

    if (req.query.selected && mongoose.Types.ObjectId.isValid(req.query.selected)) {
      selectedUser = await User.findById(req.query.selected).select('displayName email roles firstName middleName lastName');
    }

    res.render('manage-certificates', {
      user: req.user,
      trainingClasses,
      selectedUser,
      canCreateTrainingClass,
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

      if (!parsed.isLikelyMfri && (!parsed.recipientName || !parsed.trainingClassName)) {
        throw new Error('Certificate format does not match a supported MFRI certificate. Please upload manually and fill in details.');
      }

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

router.post('/classes/quick-add', isAuthenticated, hasRole(certificateManagerRoles), async (req, res) => {
  try {
    const canCreate = req.user.isAdmin || (req.user.roles && req.user.roles.includes('Training Officer'));
    if (!canCreate) {
      return res.status(403).json({
        success: false,
        error: 'Only Training Officers can create new classes.'
      });
    }

    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const hoursValueRaw = req.body.hoursValue;
    const hoursValue = hoursValueRaw === '' || hoursValueRaw == null ? 0 : Number(hoursValueRaw);

    if (!name) {
      return res.status(400).json({ success: false, error: 'Class name is required.' });
    }

    if (!Number.isFinite(hoursValue) || hoursValue < 0) {
      return res.status(400).json({ success: false, error: 'Hours must be 0 or greater.' });
    }

    const existingClass = await TrainingClass.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (existingClass) {
      return res.status(409).json({
        success: false,
        error: 'A class with this name already exists.',
        class: {
          id: existingClass._id,
          name: existingClass.name,
          hoursValue: existingClass.hoursValue
        }
      });
    }

    const trainingClass = new TrainingClass({
      name,
      description,
      hoursValue,
      createdBy: req.user._id,
      isActive: true
    });

    await trainingClass.save();

    return res.json({
      success: true,
      class: {
        id: trainingClass._id,
        name: trainingClass.name,
        hoursValue: trainingClass.hoursValue
      }
    });
  } catch (err) {
    console.error('Error creating training class from certificate workflow:', err);
    return res.status(500).json({
      success: false,
      error: 'Unable to create class right now.'
    });
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