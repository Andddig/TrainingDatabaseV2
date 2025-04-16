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
  lastName: String,
  email: String,
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  roles: { type: [String], default: ['Student'] }
}));

// Import UserQualification model
const UserQualification = require('./models/UserQualification');

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
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"]
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
    
    // If not, create a new user
    if (!user) {
      // Check if this is the designated admin email
      const isAdmin = profile.emails && 
                     profile.emails[0] && 
                     profile.emails[0].value === 'adavis@bvar19.org';
      
      user = await User.create({
        microsoftId: profile.id,
        displayName: profile.displayName,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        email: profile.emails[0].value,
        isAdmin: isAdmin,
        roles: ['Student'] // Default role
      });
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