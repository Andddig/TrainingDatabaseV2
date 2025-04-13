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

// Load route modules
const trainingRoutes = require('./routes/training');

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
  res.render('index', { user: req.user });
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

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('dashboard', { user: req.user });
});

app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
  User.find({})
    .then(users => {
      res.render('admin', { user: req.user, users });
    })
    .catch(err => {
      console.error('Error fetching users:', err);
      res.status(500).render('error', { message: 'Error fetching users' });
    });
});

// Use route modules
app.use('/training', trainingRoutes);

// API endpoint to set admin status
app.post('/api/set-admin', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { userId, isAdmin } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.isAdmin = isAdmin === true || isAdmin === 'true';
    await user.save();
    
    return res.json({ 
      success: true, 
      message: `Admin status for ${user.displayName} updated successfully`
    });
  } catch (error) {
    console.error('Error updating admin status:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error updating admin status'
    });
  }
});

// API endpoint to update user role
app.post('/api/set-role', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { userId, roles } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    if (!Array.isArray(roles)) {
      return res.status(400).json({ success: false, message: 'Roles must be an array' });
    }
    
    // Validate all roles are valid
    const validRoles = ['Student', 'Approver', 'Training Officer'];
    const allRolesValid = roles.every(role => validRoles.includes(role));
    
    if (!allRolesValid) {
      return res.status(400).json({ success: false, message: 'One or more roles are invalid' });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.roles = roles;
    await user.save();
    
    return res.json({ 
      success: true, 
      message: `Roles for ${user.displayName} updated successfully`
    });
  } catch (error) {
    console.error('Error updating user roles:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error updating user roles'
    });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.logout(function(err) {
    if (err) { 
      console.error('Logout error:', err);
      return res.status(500).render('error', { message: 'Error during logout' });
    }
    res.redirect('/');
  });
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