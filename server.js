require('dotenv').config();
console.log('Starting server initialization...');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Allow secure cookies to work behind a proxy (e.g., Docker/ingress)
app.set('trust proxy', 1);

const version = '0.9.0';

// MongoDB connection with retry logic
const connectWithRetry = () => {
  console.log('MongoDB connection attempt...');
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('MongoDB connected successfully');
    })
    .catch(err => {
      console.error('MongoDB connection error:', err);
      console.log('Retrying connection in 5 seconds...');
      setTimeout(connectWithRetry, 5000);
    });
};

console.log('Attempting to connect to MongoDB...');
connectWithRetry();

// Load User model
console.log('Initializing User model...');
const User = mongoose.model('User', new mongoose.Schema({
  microsoftId: String,
  displayName: String,
  firstName: String,
  middleName: { type: String, default: '' },
  lastName: String,
  email: String,
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  roles: { type: [String], default: ['Student'] }
}));

// Import UserQualification model
const UserQualification = require('./models/UserQualification');
const AttendantProgress = require('./models/AttendantProgress');
const Qualification = require('./models/Qualification');

// Load route modules
const trainingRoutes = require('./routes/training');
const qualificationsModule = require('./routes/qualifications');
const mfriRoutes = require('./routes/mfri');

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://stackpath.bootstrapcdn.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configure view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_do_not_use_in_production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600, // time period in seconds
    crypto: {
      secret: process.env.SESSION_SECRET || 'fallback_secret_do_not_use_in_production',
    },
    fallbackMemory: true
  }),
  cookie: {
    secure: false, // Force HTTP-only for local/dev
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Configure Microsoft Strategy
passport.use(new MicrosoftStrategy({
  clientID: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  tenant: process.env.MICROSOFT_TENANT_ID,
  scope: ['user.read']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Check if user exists
    let user = await User.findOne({ microsoftId: profile.id });

    const rawFirst = profile.name && profile.name.givenName ? profile.name.givenName : '';
    const rawLast = profile.name && profile.name.familyName ? profile.name.familyName : '';
    const rawMiddle = (profile.name && profile.name.middleName) ||
      (profile._json && (profile._json.middleName || profile._json.middle_name)) ||
      '';
    const normalizedMiddle = rawMiddle ? rawMiddle.trim() : '';
    const normalizedFirst = rawFirst ? rawFirst.trim() : '';
    const normalizedLast = rawLast ? rawLast.trim() : '';
    const fallbackDisplayName = [normalizedFirst, normalizedMiddle, normalizedLast]
      .filter(Boolean)
      .join(' ')
      .trim();
    const computedDisplayName = (profile.displayName || '').trim() || fallbackDisplayName;

    // If not, create a new user
    if (!user) {
      // Check if this is the designated admin email
      const isAdmin = profile.emails && 
                     profile.emails[0] && 
                     profile.emails[0].value === 'adavis@bvar19.org';
      
      user = await User.create({
        microsoftId: profile.id,
        displayName: computedDisplayName,
        firstName: normalizedFirst,
        middleName: normalizedMiddle,
        lastName: normalizedLast,
        email: profile.emails[0].value,
        isAdmin: isAdmin,
        roles: ['Student'] // Default role
      });
    } else {
      // Update stored name data if currently missing
      let shouldSave = false;
      if (normalizedMiddle && !user.middleName) {
        user.middleName = normalizedMiddle;
        shouldSave = true;
      }
      if (normalizedFirst && !user.firstName) {
        user.firstName = normalizedFirst;
        shouldSave = true;
      }
      if (normalizedLast && !user.lastName) {
        user.lastName = normalizedLast;
        shouldSave = true;
      }
      if (computedDisplayName && !user.displayName) {
        user.displayName = computedDisplayName;
        shouldSave = true;
      }
      if (shouldSave) {
        await user.save();
      }
    }
    
    return done(null, user);
  } catch (error) {
    console.error('Authentication error:', error);
    return done(error);
  }
}));

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) {
    return next();
  }
  res.status(403).render('error', { 
    message: 'Access denied. Admin privileges required.'
  });
};

// Role-based access control middleware
const hasRole = (requiredRoles) => {
  return (req, res, next) => {
    if (req.isAuthenticated() && (
      req.user.isAdmin || 
      requiredRoles.some(role => req.user.roles.includes(role))
    )) {
      return next();
    }
    res.status(403).render('error', { 
      message: 'Access denied. You do not have the required role.'
    });
  };
};

// Routes
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/auth/microsoft',
  passport.authenticate('microsoft', { prompt: 'select_account' })
);

app.get('/auth/microsoft/callback',
  passport.authenticate('microsoft', { 
    failureRedirect: '/login',
    failureFlash: true
  }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', isAuthenticated, async (req, res) => {
  // Redirect based on user role
  if (req.user.roles.includes('Approver')) {
    res.redirect('/training/approver/dashboard');
  } else if (req.user.roles.includes('Training Officer')) {
    res.redirect('/training/manage-classes');
  } else {
    try {
      // Get in-progress qualifications for the user
      const inProgressQualifications = await UserQualification.find({
        user: req.user._id,
        isComplete: false
      })
      .populate('qualification')
      .populate('completedClasses.class')
      .populate('missingClasses')
      .sort('-lastUpdated');

      res.render('dashboard', { 
        user: req.user,
        inProgressQualifications
      });
    } catch (err) {
      console.error('Error loading dashboard:', err);
      res.status(500).render('error', { message: 'Error loading dashboard' });
    }
  }
});

app.get('/user-management', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await User.find().sort('displayName');
    res.render('user-management', { 
      user: req.user, 
      users,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).render('error', { message: 'Error loading admin dashboard' });
  }
});

// Demo Portal Routes
app.get('/demo-portal', isAuthenticated, (req, res) => {
  res.render('demo-portal', { user: req.user });
});

app.get('/demo/attendant-packet', isAuthenticated, async (req, res) => {
  try {
    // Get user's progress
    const attendantProgress = await AttendantProgress.findOne({ user: req.user._id });
    res.render('attendant-packet', { 
      user: req.user,
      calls: attendantProgress ? attendantProgress.calls : null,
      completedCalls: attendantProgress ? attendantProgress.completedCalls : 0
    });
  } catch (err) {
    console.error('Error loading attendant packet:', err);
    res.status(500).render('error', { message: 'Error loading attendant packet' });
  }
});

// Save attendant progress
app.post('/demo/save-attendant-progress', isAuthenticated, async (req, res) => {
  try {
    const { callNumber, incident, type, disposition } = req.body;
    
    // Validate call number
    if (!callNumber || isNaN(callNumber)) {
      return res.status(400).json({ success: false, error: 'Invalid call number' });
    }
    
    // Find or create progress document
    let progress = await AttendantProgress.findOne({ user: req.user._id });
    if (!progress) {
      progress = new AttendantProgress({
        user: req.user._id,
        calls: new Map(),
        completedCalls: 0
      });
    }
    
    // Convert calls Map to object if it's not already
    if (!(progress.calls instanceof Map)) {
      progress.calls = new Map(Object.entries(progress.calls || {}));
    }
    
    // Update call data
    progress.calls.set(callNumber.toString(), {
      incident,
      type,
      disposition,
      completed: true
    });
    
    // Update completed calls count
    progress.completedCalls = Array.from(progress.calls.values()).filter(call => call.completed).length;
    
    await progress.save();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving attendant progress:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Award attendant qualification
app.post('/demo/award-attendant-qualification', isAuthenticated, async (req, res) => {
  try {
    // Check if user has completed all calls
    const progress = await AttendantProgress.findOne({ user: req.user._id });
    if (!progress || progress.completedCalls < 12) {
      return res.status(400).json({ success: false, error: 'Not all calls are completed' });
    }

    // Find or create the attendant qualification
    let qualification = await Qualification.findOne({ name: 'Attendant' });
    if (!qualification) {
      qualification = new Qualification({
        name: 'Attendant',
        description: 'Completed 12 calls as an attendant',
        requiredClasses: [],
        createdBy: req.user._id
      });
      await qualification.save();
    }

    // Create or update user qualification
    let userQualification = await UserQualification.findOne({
      user: req.user._id,
      qualification: qualification._id
    });

    if (!userQualification) {
      userQualification = new UserQualification({
        user: req.user._id,
        qualification: qualification._id,
        isComplete: true,
        earnedDate: new Date(),
        lastUpdated: new Date()
      });
    } else {
      userQualification.isComplete = true;
      userQualification.earnedDate = new Date();
      userQualification.lastUpdated = new Date();
    }

    await userQualification.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error awarding attendant qualification:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin route to remove attendant qualification
app.post('/demo/remove-attendant-qualification', isAuthenticated, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Find the attendant qualification
    const qualification = await Qualification.findOne({ name: 'Attendant' });
    if (!qualification) {
      return res.status(404).json({ success: false, error: 'Attendant qualification not found' });
    }

    // Remove user qualification
    await UserQualification.deleteOne({
      user: userId,
      qualification: qualification._id
    });

    // Reset attendant progress
    await AttendantProgress.deleteOne({ user: userId });

    res.json({ success: true });
  } catch (err) {
    console.error('Error removing attendant qualification:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// User role management
app.post('/user-management/update-user/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { roles } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    user.roles = Array.isArray(roles) ? roles : [roles];
    await user.save();
    
    res.redirect('/user-management?success=User roles updated successfully');
  } catch (err) {
    console.error('Error updating user roles:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error updating user roles'));
  }
});

app.post('/user-management/update-user-details/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }

    const firstName = (req.body.firstName || '').trim();
    const middleName = (req.body.middleName || '').trim();
    const lastName = (req.body.lastName || '').trim();
    let displayName = (req.body.displayName || '').trim();

    if (!firstName || !lastName) {
      return res.redirect('/user-management?error=' + encodeURIComponent('First and last name are required.'));
    }

    if (!displayName) {
      displayName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    }

    user.firstName = firstName;
    user.middleName = middleName;
    user.lastName = lastName;
    user.displayName = displayName;

    await user.save();

    res.redirect('/user-management?success=User details updated successfully');
  } catch (err) {
    console.error('Error updating user details:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error updating user details'));
  }
});

// Toggle admin status
app.post('/user-management/toggle-admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    // Don't allow removing admin from main admin account
    if (user.email === 'adavis@bvar19.org' && user.isAdmin) {
      return res.redirect('/user-management?error=Cannot remove admin status from the primary administrator');
    }
    
    user.isAdmin = !user.isAdmin;
    await user.save();
    
    res.redirect('/user-management?success=Admin status updated successfully');
  } catch (err) {
    console.error('Error toggling admin status:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error updating admin status'));
  }
});

// Logout route
app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Register training routes
app.use('/training', trainingRoutes);

// Register qualification routes
app.use('/qualifications', qualificationsModule.router);

// Register MFRI routes
app.use('/mfri', mfriRoutes);

// Hook for updating qualifications when a training submission is approved
// This approach is safer than trying to patch the existing route handler directly
app.use(async (req, res, next) => {
  // Store the original end method
  const originalEnd = res.end;
  
  // Override the end method
  res.end = async function(chunk, encoding) {
    // If this is a training approval route
    if (req.method === 'POST' && req.path.match(/\/training\/submission\/.*\/approve$/)) {
      try {
        // Get the submission ID from the URL
        const submissionId = req.path.split('/')[3];
        const submission = await mongoose.model('TrainingSubmission').findById(submissionId);
        
        if (submission && submission.status === 'approved') {
          // Process qualification updates in the background
          setTimeout(async () => {
            try {
              await qualificationsModule.updateUserQualificationsForApprovedSubmission(submission);
              console.log(`Qualifications updated for submission ${submission._id}`);
            } catch (err) {
              console.error('Error in background qualification update:', err);
            }
          }, 0);
        }
      } catch (err) {
        console.error('Error checking for qualification updates:', err);
      }
    }
    
    // Call the original end method
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).render('error', { message: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).render('error', { message: 'Server error' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 