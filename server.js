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
const multer = require('multer');
const { parse } = require('csv-parse/sync');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

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
const User = require('./models/User');

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
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
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
    // Fallback to in-memory store if MongoDB is not available
    fallbackMemory: true
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// File upload (CSV) for admin user import
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

const ALLOWED_ROLES = ['Student', 'Approver', 'Training Officer'];

const normalizeRoles = (roles) => {
  const roleList = Array.isArray(roles) ? roles : (roles ? [roles] : ['Student']);
  const cleaned = roleList.map(r => r.trim()).filter(Boolean);
  const filtered = cleaned.filter(r => ALLOWED_ROLES.includes(r));
  return filtered.length ? filtered : ['Student'];
};

// Configure Microsoft Strategy
passport.use(new MicrosoftStrategy({
  clientID: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  tenant: process.env.MICROSOFT_TENANT_ID,
  scope: ['user.read']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await User.findOrCreateFromMicrosoft(profile);
      
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
  res.render('index', { user: req.user, version });
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

app.get('/admin', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await User.find().sort('displayName');
    res.render('admin', { 
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

// Add a single user (manual entry)
app.post('/admin/add-user', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { email, displayName, firstName, lastName, roles, isAdmin: adminFlag } = req.body;

    if (!email || email.trim() === '') {
      return res.redirect('/admin?error=Email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const resolvedRoles = normalizeRoles(roles);

    const resolvedDisplayName = (displayName && displayName.trim() !== '')
      ? displayName.trim()
      : [firstName, lastName].filter(Boolean).join(' ').trim();

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      existingUser.displayName = resolvedDisplayName || existingUser.displayName;
      existingUser.firstName = firstName || existingUser.firstName;
      existingUser.lastName = lastName || existingUser.lastName;
      existingUser.roles = resolvedRoles;
      existingUser.isAdmin = adminFlag === 'true' || adminFlag === 'on';
      await existingUser.save();
      return res.redirect('/admin?success=User updated successfully');
    }

    await User.create({
      email: normalizedEmail,
      displayName: resolvedDisplayName || normalizedEmail,
      firstName: firstName || '',
      lastName: lastName || '',
      roles: resolvedRoles,
      isAdmin: adminFlag === 'true' || adminFlag === 'on'
    });

    res.redirect('/admin?success=User added successfully');
  } catch (err) {
    console.error('Error adding user:', err);
    res.redirect('/admin?error=' + encodeURIComponent(err.message || 'Error adding user'));
  }
});

// Import users from CSV
app.post('/admin/import-users', isAuthenticated, isAdmin, csvUpload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.redirect('/admin?error=CSV file is required');
    }

    const csvText = req.file.buffer.toString('utf8');
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const email = (record.email || record.Email || '').trim().toLowerCase();
      if (!email) {
        continue;
      }

      const displayName = (record.displayName || record.DisplayName || '').trim();
      const firstName = (record.firstName || record.FirstName || '').trim();
      const lastName = (record.lastName || record.LastName || '').trim();
      const rolesRaw = record.roles || record.Roles || '';
      const roles = normalizeRoles(
        rolesRaw ? rolesRaw.split(/[,;|]/) : ['Student']
      );
      const isAdminValue = (record.isAdmin || record.IsAdmin || '').toString().toLowerCase();
      const isAdmin = ['true', 'yes', '1'].includes(isAdminValue);

      const resolvedDisplayName = displayName || [firstName, lastName].filter(Boolean).join(' ').trim() || email;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        existingUser.displayName = resolvedDisplayName || existingUser.displayName;
        existingUser.firstName = firstName || existingUser.firstName;
        existingUser.lastName = lastName || existingUser.lastName;
        existingUser.roles = roles;
        existingUser.isAdmin = isAdmin;
        await existingUser.save();
        updatedCount += 1;
      } else {
        await User.create({
          email,
          displayName: resolvedDisplayName,
          firstName,
          lastName,
          roles,
          isAdmin
        });
        createdCount += 1;
      }
    }

    res.redirect(`/admin?success=Import complete. Created ${createdCount}, Updated ${updatedCount}`);
  } catch (err) {
    console.error('Error importing users:', err);
    res.redirect('/admin?error=' + encodeURIComponent(err.message || 'Error importing users'));
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
app.post('/admin/update-user/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { roles } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    user.roles = Array.isArray(roles) ? roles : [roles];
    await user.save();
    
    res.redirect('/admin?success=User roles updated successfully');
  } catch (err) {
    console.error('Error updating user roles:', err);
    res.redirect('/admin?error=' + encodeURIComponent(err.message || 'Error updating user roles'));
  }
});

// Toggle admin status
app.post('/admin/toggle-admin/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    // Don't allow removing admin from main admin account
    if (user.email === 'adavis@bvar19.org' && user.isAdmin) {
      return res.redirect('/admin?error=Cannot remove admin status from the primary administrator');
    }
    
    user.isAdmin = !user.isAdmin;
    await user.save();
    
    res.redirect('/admin?success=Admin status updated successfully');
  } catch (err) {
    console.error('Error toggling admin status:', err);
    res.redirect('/admin?error=' + encodeURIComponent(err.message || 'Error updating admin status'));
  }
});

// Delete user
app.post('/admin/delete-user/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }

    // Don't allow deleting the primary admin account
    if (user.email === 'adavis@bvar19.org') {
      return res.redirect('/admin?error=Cannot delete the primary administrator');
    }

    await User.deleteOne({ _id: user._id });

    res.redirect('/admin?success=User deleted successfully');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.redirect('/admin?error=' + encodeURIComponent(err.message || 'Error deleting user'));
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