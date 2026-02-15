const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');


// Import models
const Qualification = require('../models/Qualification');
const UserQualification = require('../models/UserQualification');
const TrainingClass = require('../models/TrainingClass');
const TrainingSubmission = require('../models/TrainingSubmission');
const User = mongoose.model('User');
const MfriClass = require('../models/mfriClass');

// Authentication middleware (copied from training.js)
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Role-based middleware (copied from training.js)
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

const isTrainingOfficer = (req, res, next) => {
  if (req.isAuthenticated() && (req.user.isAdmin || req.user.roles.includes('Training Officer'))) {
    return next();
  }
  res.status(403).render('error', { 
    message: 'Access denied. Training Officer privileges required.'
  });
};

// Manage qualifications page (Training Officer)
router.get('/manage', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const qualifications = await Qualification.find({})
      .populate('requiredClasses')
      .sort('name');
    const trainingClasses = await TrainingClass.find({ isActive: true }).sort('name');
    res.render('manage-qualifications', {
      user: req.user,
      qualifications,
      trainingClasses,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching qualifications:', err);
    res.status(500).render('error', { message: 'Error loading qualifications' });
  }
});


// Find & Start Qualifications page
router.get('/find', isAuthenticated, async (req, res) => {
  try {
    const availableQualifications = await Qualification.find({ isActive: true })
      .populate('requiredClasses');
    res.render('find-qualifications', {
      user: req.user,
      availableQualifications
    });
  } catch (err) {
    console.error('Error loading available qualifications:', err);
    res.status(500).render('error', { message: 'Error loading available qualifications' });
  }
});


// Add qualification
router.post('/add', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const { name, description } = req.body;
    let { requiredClasses } = req.body;

    // Validate input
    if (!name) {
      return res.redirect('/qualifications/manage?error=Qualification name is required');
    }
    if (!requiredClasses || (Array.isArray(requiredClasses) && requiredClasses.length === 0)) {
      return res.redirect('/qualifications/manage?error=At least one required class must be selected');
    }
    // If requiredClasses is a string with commas, split it into an array
    if (typeof requiredClasses === 'string') {
      requiredClasses = requiredClasses.includes(',') ? requiredClasses.split(',').map(s => s.trim()) : [requiredClasses];
    }
    // Create qualification
    const qualification = new Qualification({
      name,
      description,
      requiredClasses,
      createdBy: req.user._id
    });
    await qualification.save();
    res.redirect('/qualifications/manage?success=Qualification created successfully');
  } catch (err) {
    console.error('Error creating qualification:', err);
    res.redirect('/qualifications/manage?error=' + encodeURIComponent(err.message || 'Error creating qualification'));
  }
});

// Edit qualification page
router.get('/edit/:id', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const qualification = await Qualification.findById(req.params.id)
      .populate('requiredClasses');
    
    if (!qualification) {
      return res.status(404).render('error', { message: 'Qualification not found' });
    }
    
    const trainingClasses = await TrainingClass.find({}).sort('name');
    
    res.render('edit-qualification', { 
      user: req.user, 
      qualification,
      trainingClasses,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching qualification:', err);
    res.status(500).render('error', { message: 'Error loading qualification' });
  }
});

// Update qualification
router.post('/update/:id', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    let { requiredClasses } = req.body;

    // Validate input
    if (!name) {
      return res.redirect(`/qualifications/edit/${req.params.id}?error=Qualification name is required`);
    }

    if (!requiredClasses || (Array.isArray(requiredClasses) && requiredClasses.length === 0)) {
      return res.redirect(`/qualifications/edit/${req.params.id}?error=At least one required class must be selected`);
    }

    // If requiredClasses is a string with commas, split it into an array
    if (typeof requiredClasses === 'string') {
      requiredClasses = requiredClasses.includes(',') ? requiredClasses.split(',').map(s => s.trim()) : [requiredClasses];
    }

    // Update qualification
    const qualification = await Qualification.findById(req.params.id);

    if (!qualification) {
      return res.status(404).render('error', { message: 'Qualification not found' });
    }

    qualification.name = name;
    qualification.description = description;
    qualification.requiredClasses = requiredClasses;
    qualification.isActive = isActive === 'true';
    qualification.updatedAt = new Date();

    await qualification.save();

    // Update user qualifications based on the changes
    await updateUserQualificationsForChangedDefinition(qualification._id);

    res.redirect(`/qualifications/edit/${req.params.id}?success=Qualification updated successfully`);
  } catch (err) {
    console.error('Error updating qualification:', err);
    res.redirect(`/qualifications/edit/${req.params.id}?error=` + encodeURIComponent(err.message || 'Error updating qualification'));
  }
});

// Toggle qualification status
router.post('/toggle-status/:id', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const qualification = await Qualification.findById(req.params.id);
    
    if (!qualification) {
      return res.status(404).render('error', { message: 'Qualification not found' });
    }
    
    qualification.isActive = !qualification.isActive;
    qualification.updatedAt = new Date();
    
    await qualification.save();
    
    res.redirect('/qualifications/manage?success=Qualification status updated successfully');
  } catch (err) {
    console.error('Error toggling qualification status:', err);
    res.redirect('/qualifications/manage?error=' + encodeURIComponent(err.message || 'Error updating qualification status'));
  }
});

// QUALIFICATION DASHBOARD (TRAINING OFFICER)

// Qualification dashboard for training officers
router.get('/dashboard', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    // Get filter parameters
    const filter = {
      userName: req.query.userName || '',
      qualification: req.query.qualification || '',
      status: req.query.status || 'all'
    };
    
    // Build query
    let query = {};
    
    if (filter.userName) {
      const users = await User.find({
        $or: [
          { displayName: { $regex: filter.userName, $options: 'i' } },
          { email: { $regex: filter.userName, $options: 'i' } }
        ]
      });
      
      const userIds = users.map(u => u._id);
      query.user = { $in: userIds };
    }
    
    if (filter.qualification) {
      query.qualification = filter.qualification;
    }
    
    if (filter.status === 'complete') {
      query.isComplete = true;
    } else if (filter.status === 'incomplete') {
      query.isComplete = false;
    }
    
    // Get user qualifications
    const userQualifications = await UserQualification.find(query)
      .populate('user')
      .populate('qualification')
      .populate('completedClasses.class')
      .populate('missingClasses')
      .sort('-lastUpdated');
    
    // Get all qualifications for the filter dropdown
    const qualificationList = await Qualification.find({}).sort('name');
    
    // Calculate stats
    const stats = {
      totalUsers: await User.countDocuments({}),
      totalQualifications: userQualifications.length,
      completedQualifications: userQualifications.filter(uq => uq.isComplete).length,
      inProgressQualifications: userQualifications.filter(uq => !uq.isComplete).length
    };
    
    res.render('qualification-dashboard', { 
      user: req.user, 
      userQualifications,
      qualificationList,
      filter,
      stats,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error loading qualification dashboard:', err);
    res.status(500).render('error', { message: 'Error loading qualification dashboard' });
  }
});

// Qualification details page
router.get('/details/:id', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const userQualification = await UserQualification.findById(req.params.id)
      .populate('user')
      .populate('qualification')
      .populate('completedClasses.class')
      .populate('completedClasses.submission')
      .populate('missingClasses');
    
    if (!userQualification) {
      return res.status(404).render('error', { message: 'Qualification record not found' });
    }
    
    res.render('qualification-detail', { 
      user: req.user, 
      userQualification,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error loading qualification details:', err);
    res.status(500).render('error', { message: 'Error loading qualification details' });
  }
});

// Manually mark qualification as complete
router.post('/mark-complete/:id', isAuthenticated, isTrainingOfficer, async (req, res) => {
  try {
    const userQualification = await UserQualification.findById(req.params.id);
    
    if (!userQualification) {
      return res.status(404).render('error', { message: 'Qualification record not found' });
    }
    
    userQualification.isComplete = true;
    userQualification.earnedDate = new Date();
    userQualification.lastUpdated = new Date();
    
    await userQualification.save();
    
    res.redirect(`/qualifications/details/${req.params.id}?success=Qualification marked as complete`);
  } catch (err) {
    console.error('Error marking qualification as complete:', err);
    res.redirect(`/qualifications/details/${req.params.id}?error=` + encodeURIComponent(err.message || 'Error updating qualification status'));
  }
});

// STUDENT QUALIFICATION ROUTES

// View my qualifications
router.get('/my', isAuthenticated, async (req, res) => {
  try {
    // Get user's qualifications
    const userQualifications = await UserQualification.find({ user: req.user._id })
      .populate('qualification')
      .populate('completedClasses.class')
      .populate('missingClasses');
    
    // Separate completed and in-progress qualifications
    const completedQualifications = userQualifications.filter(uq => uq.isComplete);
    const inProgressQualifications = userQualifications.filter(uq => !uq.isComplete);
    
    // Get qualifications the user hasn't started yet
    const userQualificationIds = userQualifications.map(uq => uq.qualification._id.toString());
    const availableQualifications = await Qualification.find({ 
      _id: { $nin: userQualificationIds },
      isActive: true
    }).populate('requiredClasses');

    // Get MFRI classes
    const mfriClasses = await MfriClass.find({ 
      startDate: { $gte: new Date() } 
    }).sort({ startDate: 1 });
    
    res.render('my-qualifications', { 
      user: req.user, 
      completedQualifications,
      inProgressQualifications,
      availableQualifications,
      mfriClasses,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error loading my qualifications:', err);
    res.status(500).render('error', { message: 'Error loading qualifications' });
  }
});

// Start a qualification
router.get('/start/:id', isAuthenticated, async (req, res) => {
  try {
    const qualification = await Qualification.findById(req.params.id)
      .populate('requiredClasses');
    
    if (!qualification) {
      return res.status(404).render('error', { message: 'Qualification not found' });
    }
    
    if (!qualification.isActive) {
      return res.redirect('/qualifications/my?error=This qualification is no longer active');
    }
    
    // Check if the user already has this qualification
    const existingQualification = await UserQualification.findOne({
      user: req.user._id,
      qualification: qualification._id
    });
    
    if (existingQualification) {
      return res.redirect('/qualifications/my?error=You have already started this qualification');
    }
    
    // Find any completed classes that would apply to this qualification
    const completedSubmissions = await TrainingSubmission.find({
      student: req.user._id,
      status: 'approved',
      trainingClass: { $in: qualification.requiredClasses }
    }).populate('trainingClass');
    
    // Create arrays of completed and missing classes
    const completedClasses = completedSubmissions.map(submission => ({
      class: submission.trainingClass._id,
      submission: submission._id,
      completedDate: submission.approvedAt
    }));
    
    const completedClassIds = completedSubmissions.map(s => s.trainingClass._id.toString());
    const missingClasses = qualification.requiredClasses.filter(
      classItem => !completedClassIds.includes(classItem._id.toString())
    );
    
    // Determine if qualification is already complete
    const isComplete = missingClasses.length === 0;
    
    // Create user qualification
    const userQualification = new UserQualification({
      user: req.user._id,
      qualification: qualification._id,
      isComplete,
      completedClasses,
      missingClasses,
      earnedDate: isComplete ? new Date() : null
    });
    
    await userQualification.save();
    
    res.redirect('/qualifications/my?success=Qualification added to your profile');
  } catch (err) {
    console.error('Error starting qualification:', err);
    res.redirect('/qualifications/my?error=' + encodeURIComponent(err.message || 'Error starting qualification'));
  }
});

// UTILITY FUNCTIONS

// Function to update user qualifications when a certificate is approved
async function updateUserQualificationsForApprovedSubmission(submission) {
  try {
    const userQualifications = await UserQualification.find({
      user: submission.student,
      missingClasses: submission.trainingClass,
      isComplete: false
    }).populate('qualification');
    
    if (userQualifications.length === 0) return;
    
    for (const userQualification of userQualifications) {
      // Move class from missing to completed
      userQualification.missingClasses = userQualification.missingClasses.filter(
        classId => classId.toString() !== submission.trainingClass.toString()
      );
      
      userQualification.completedClasses.push({
        class: submission.trainingClass,
        submission: submission._id,
        completedDate: submission.approvedAt
      });
      
      // Check if qualification is now complete
      if (userQualification.missingClasses.length === 0) {
        userQualification.isComplete = true;
        userQualification.earnedDate = new Date();
      }
      
      userQualification.lastUpdated = new Date();
      await userQualification.save();
    }
  } catch (err) {
    console.error('Error updating user qualifications:', err);
  }
}

// Function to fully recalculate a user's qualifications based on approved submissions
async function recalculateUserQualifications(userId) {
  try {
    const userQualifications = await UserQualification.find({ user: userId })
      .populate('qualification');
    if (userQualifications.length === 0) {
      return;
    }

    const approvedSubmissions = await TrainingSubmission.find({
      student: userId,
      status: 'approved'
    }).select('_id trainingClass approvedAt');

    const submissionByClass = new Map();
    approvedSubmissions.forEach(submission => {
      submissionByClass.set(submission.trainingClass.toString(), submission);
    });

    for (const userQualification of userQualifications) {
      if (!userQualification.qualification) {
        continue;
      }

      const requiredClasses = (userQualification.qualification.requiredClasses || []).map(id => id.toString());
      const updatedCompleted = [];
      const updatedMissing = [];

      requiredClasses.forEach(classId => {
        const submission = submissionByClass.get(classId);
        if (submission) {
          updatedCompleted.push({
            class: submission.trainingClass,
            submission: submission._id,
            completedDate: submission.approvedAt
          });
        } else {
          updatedMissing.push(mongoose.Types.ObjectId(classId));
        }
      });

      userQualification.completedClasses = updatedCompleted;
      userQualification.missingClasses = updatedMissing;
      userQualification.isComplete = updatedMissing.length === 0;
      userQualification.earnedDate = userQualification.isComplete
        ? (userQualification.earnedDate || new Date())
        : null;
      userQualification.lastUpdated = new Date();
      userQualification.markModified('completedClasses');
      userQualification.markModified('missingClasses');

      await userQualification.save();
    }
  } catch (err) {
    console.error('Error recalculating user qualifications:', err);
  }
}

// Function to update user qualifications when a qualification definition changes
async function updateUserQualificationsForChangedDefinition(qualificationId) {
  try {
    const qualification = await Qualification.findById(qualificationId);
    if (!qualification) {
      return;
    }
    
    const userQualifications = await UserQualification.find({
      qualification: qualificationId
    }).populate('completedClasses.class');
    
    for (const userQualification of userQualifications) {
      // Get completed class IDs
      const completedClassIds = userQualification.completedClasses.map(
        c => c.class._id.toString()
      );
      
      // Update missing classes based on the new definition
      userQualification.missingClasses = qualification.requiredClasses.filter(
        classId => !completedClassIds.includes(classId.toString())
      );
      // Update completion status
      userQualification.isComplete = userQualification.missingClasses.length === 0;
      
      // Update earned date if newly completed
      if (userQualification.isComplete && !userQualification.earnedDate) {
        userQualification.earnedDate = new Date();
      } else if (!userQualification.isComplete) {
        userQualification.earnedDate = null;
      }
      
      userQualification.lastUpdated = new Date();
      await userQualification.save();
    }
  } catch (err) {
    console.error('Error updating user qualifications for changed definition:', err);
  }
}

// Function to import MFRI classes into training classes
async function importMfriClasses() {
    try {
        const mfriClasses = await MfriClass.find({});
        const trainingClass = mongoose.model('TrainingClass');
        
        for (const mfriClass of mfriClasses) {
            // Check if class already exists
            const existingClass = await trainingClass.findOne({ 
                name: mfriClass.title 
            });
            
            if (!existingClass) {
                // Create new training class
                const newClass = new trainingClass({
                    name: mfriClass.title,
                    hoursValue: mfriClass.instructionalHours,
                    isActive: true
                });
                
                await newClass.save();
                console.log(`Imported class: ${mfriClass.title}`);
            }
        }
        
        console.log('MFRI class import completed');
    } catch (err) {
        console.error('Error importing MFRI classes:', err);
    }
}

// Add route to trigger import
router.get('/import-mfri-classes', isAuthenticated, isTrainingOfficer, async (req, res) => {
    try {
        await importMfriClasses();
        res.redirect('/qualifications/manage?success=MFRI classes imported successfully');
    } catch (err) {
        console.error('Error importing MFRI classes:', err);
        res.redirect('/qualifications/manage?error=Error importing MFRI classes');
    }
});

// Export the router and utility functions
module.exports = {
  router,
  updateUserQualificationsForApprovedSubmission,
  recalculateUserQualifications
}; 