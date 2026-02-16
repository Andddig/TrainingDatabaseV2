require('dotenv').config();
console.log('Starting server initialization...');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

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
const User = require('./models/User');

// Import UserQualification model
const UserQualification = require('./models/UserQualification');
const AttendantProgress = require('./models/AttendantProgress');
const AttendantPacket = require('./models/AttendantPacket');
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

// File upload (CSV) for admin user import
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

const ALLOWED_ROLES = ['Student', 'Approver', 'Training Officer', 'Rescue Officer', 'Evaluator', 'Rescue Chief'];

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
    let user = await User.findOrCreateFromMicrosoft(profile);

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
    res.status(500).render('error', { message: 'Error loading user management dashboard' });
  }
});

app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
  res.redirect('/user-management');
});

// Add a single user (manual entry)
app.post(['/user-management/add-user', '/admin/add-user'], isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { email, displayName, firstName, lastName, roles, isAdmin: adminFlag } = req.body;

    if (!email || email.trim() === '') {
      return res.redirect('/user-management?error=Email is required');
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
      return res.redirect('/user-management?success=User updated successfully');
    }

    await User.create({
      email: normalizedEmail,
      displayName: resolvedDisplayName || normalizedEmail,
      firstName: firstName || '',
      lastName: lastName || '',
      roles: resolvedRoles,
      isAdmin: adminFlag === 'true' || adminFlag === 'on'
    });

    res.redirect('/user-management?success=User added successfully');
  } catch (err) {
    console.error('Error adding user:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error adding user'));
  }
});

// Import users from CSV
app.post(['/user-management/import-users', '/admin/import-users'], isAuthenticated, isAdmin, csvUpload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.redirect('/user-management?error=CSV file is required');
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

    res.redirect(`/user-management?success=Import complete. Created ${createdCount}, Updated ${updatedCount}`);
  } catch (err) {
    console.error('Error importing users:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error importing users'));
  }
});

// Demo Portal Routes
app.get('/demo-portal', isAuthenticated, (req, res) => {
  res.render('demo-portal', { user: req.user });
});

app.get(['/qualifications/attendant-packet-queue', '/demo/attendant-packet-queue'], isAuthenticated, async (req, res) => {
  try {
    if (!canManageAttendantPackets(req.user)) {
      return res.status(403).render('error', { message: 'Access denied. Packet queue roles required.' });
    }

    const packets = await AttendantPacket.find({
      status: { $in: ['in_progress', 'pending_chief_review', 'pending_more_evaluation'] }
    })
      .populate('candidate', 'displayName email')
      .populate('sponsoringRescueOfficer', 'displayName email')
      .populate('rescueChief', 'displayName email')
      .sort('-updatedAt')
      .limit(300);

    const evaluatorQueue = [];
    const rescueOfficerQueue = [];
    const rescueChiefQueue = [];

    packets.forEach(packet => {
      const completedCalls = packet.callSheets.filter(call => call.status === 'completed').length;

      packet.callSheets.forEach(call => {
        if (call.status === 'awaiting_evaluator_signature') {
          evaluatorQueue.push({
            packetId: packet._id,
            callNumber: call.callNumber,
            candidateName: packet.candidate ? packet.candidate.displayName : 'Unknown',
            incidentDate: call.incidentDate,
            fcIncidentNumber: call.fcIncidentNumber || '',
            updatedAt: packet.updatedAt
          });
        }

        if (call.status === 'awaiting_rescue_officer_signature') {
          rescueOfficerQueue.push({
            packetId: packet._id,
            callNumber: call.callNumber,
            candidateName: packet.candidate ? packet.candidate.displayName : 'Unknown',
            incidentDate: call.incidentDate,
            fcIncidentNumber: call.fcIncidentNumber || '',
            sponsoringRescueOfficer: packet.sponsoringRescueOfficer ? packet.sponsoringRescueOfficer.displayName : '',
            updatedAt: packet.updatedAt
          });
        }
      });

      if (packet.status === 'pending_chief_review') {
        rescueChiefQueue.push({
          packetId: packet._id,
          candidateName: packet.candidate ? packet.candidate.displayName : 'Unknown',
          eligibilityPath: packet.eligibilityPath,
          completedCalls,
          rescueChief: packet.rescueChief ? packet.rescueChief.displayName : '',
          updatedAt: packet.updatedAt
        });
      }
    });

    evaluatorQueue.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    rescueOfficerQueue.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    rescueChiefQueue.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.render('attendant-packet-queue', {
      user: req.user,
      canEvaluateCallSheet: canEvaluateCallSheet(req.user),
      canRescueOfficerSign: canRescueOfficerSign(req.user),
      canPerformFinalReview: canPerformFinalReview(req.user),
      evaluatorQueue,
      rescueOfficerQueue,
      rescueChiefQueue
    });
  } catch (err) {
    console.error('Error loading attendant packet queue:', err);
    res.status(500).render('error', { message: 'Error loading attendant packet queue' });
  }
});

const hasAnyRole = (user, roles) => {
  if (!user || !Array.isArray(user.roles)) {
    return false;
  }

  return roles.some(role => user.roles.includes(role));
};

const canManageAttendantPackets = (user) => {
  if (!user) {
    return false;
  }

  return user.isAdmin || hasAnyRole(user, ['Approver', 'Training Officer', 'Rescue Officer', 'Evaluator', 'Rescue Chief']);
};

const canCreatePacket = (user) => {
  return !!user && (user.isAdmin || hasAnyRole(user, ['Training Officer', 'Rescue Officer', 'Approver']));
};

const canEvaluateCallSheet = (user) => {
  return !!user && (user.isAdmin || hasAnyRole(user, ['Evaluator']));
};

const canRescueOfficerSign = (user) => {
  return !!user && (user.isAdmin || hasAnyRole(user, ['Rescue Officer']));
};

const canPerformFinalReview = (user) => {
  return !!user && (user.isAdmin || hasAnyRole(user, ['Rescue Chief']));
};

const hasAttendantPacketAccess = (packet, user) => {
  if (!packet || !user) {
    return false;
  }

  if (canManageAttendantPackets(user)) {
    return true;
  }

  const candidateId = packet.candidate && packet.candidate._id
    ? packet.candidate._id.toString()
    : (packet.candidate ? packet.candidate.toString() : null);
  return candidateId === user._id.toString();
};

const ATTENDANT_SKILLS = [
  'Response - Map reading',
  'Response - Radio use',
  'Response - Communication with Driver',
  'Physical Assessment - Initial',
  'Physical Assessment - Focused/Rapid',
  'Physical Assessment - Vitals',
  'Physical Assessment - Ongoing',
  'Subjective Interview - SAMPLE',
  'Subjective Interview - OPQRST',
  'Airway Maintenance - Positioning',
  'Airway Maintenance - Suctioning',
  'Airway Maintenance - Airway Adjuncts',
  'Airway Maintenance - Oxygen Admin (Correct LPM)',
  'Airway Maintenance - Oxygen Admin (Correct Device)',
  'Airway Maintenance - Mechanical Ventilation',
  'Medical Emergencies - CPR & AED (Role)',
  'Medical Emergencies - Medication Administration',
  'Trauma Emergencies - Spinal Immobilization (Device/Role)',
  'Trauma Emergencies - Fracture Management (Device/Role)',
  'Trauma Emergencies - Bleeding Control (Method Used)',
  'Transport & Disposition - Movement of Patient to Stretcher',
  'Transport & Disposition - Cot Operations',
  'Transport & Disposition - Consultation',
  'Transport & Disposition - Turn Over Report (To Whom)',
  'Communication Skills - With Patient',
  'Communication Skills - With ALS Personnel',
  'Communication Skills - With Family/Bystanders',
  'Scene Management - Time Management',
  'Scene Management - Functions as Lead Provider',
  'Scene Management - Protocol Followed'
];

const buildDefaultSkillRatings = () => {
  return ATTENDANT_SKILLS.map(skill => ({ skill, rating: 'NA', comments: '' }));
};

const buildDefaultCallSheets = () => {
  return Array.from({ length: 12 }, (_, idx) => ({
    callNumber: idx + 1,
    status: 'draft',
    skillRatings: buildDefaultSkillRatings(),
    independentFieldReady: {
      value: 'not_evaluated',
      comments: ''
    }
  }));
};

const BLOCK_DUPLICATE_ATTENDANT_PACKET_STATUSES = [
  'in_progress',
  'pending_chief_review',
  'pending_more_evaluation',
  'approved'
];

const syncAttendantProgressFromPacket = async (packet) => {
  if (!packet || packet.eligibilityPath !== 'trips') {
    return;
  }

  const callsMap = new Map();
  packet.callSheets
    .filter(call => call.status === 'completed')
    .forEach(call => {
      callsMap.set(call.callNumber.toString(), {
        incident: call.fcIncidentNumber || '',
        type: call.incidentType || '',
        disposition: call.patientPriority || '',
        completed: true
      });
    });

  await AttendantProgress.findOneAndUpdate(
    { user: packet.candidate },
    {
      user: packet.candidate,
      calls: callsMap,
      completedCalls: callsMap.size
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

const awardAttendantQualificationForUser = async (userId, actingUserId) => {
  let qualification = await Qualification.findOne({ name: 'Attendant' });
  if (!qualification) {
    qualification = new Qualification({
      name: 'Attendant',
      description: 'Completed Attendant packet requirements',
      requiredClasses: [],
      createdBy: actingUserId
    });
    await qualification.save();
  }

  let userQualification = await UserQualification.findOne({
    user: userId,
    qualification: qualification._id
  });

  if (!userQualification) {
    userQualification = new UserQualification({
      user: userId,
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
};

const findCallSheet = (packet, callNumber) => {
  return packet.callSheets.find(call => call.callNumber === Number(callNumber));
};

const parseDateOrNull = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const VALID_PACKET_PDF_SCOPES = ['full', 'completed', 'summary'];

const formatDateForFilename = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const sanitizeFilenameSegment = (value) => {
  return (value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
};

const buildPacketPdfFilename = (packet, scope) => {
  const candidateName = packet.candidate && packet.candidate.displayName
    ? packet.candidate.displayName
    : 'candidate';
  const normalizedName = sanitizeFilenameSegment(candidateName);
  const datePart = formatDateForFilename(new Date());
  return `attendant-packet-${normalizedName}-${scope}-${datePart}.pdf`;
};

const getPacketCompletedCallCount = (packet) => {
  return packet.callSheets.filter(call => call.status === 'completed').length;
};

const getPacketCallSheetsForScope = (packet, scope) => {
  const sorted = [...packet.callSheets].sort((a, b) => a.callNumber - b.callNumber);

  if (scope === 'completed') {
    return sorted.filter(call => call.status === 'completed');
  }

  if (scope === 'summary') {
    return [];
  }

  return sorted;
};

const buildPacketPdfViewModel = (packet, scope) => {
  const completedCallCount = getPacketCompletedCallCount(packet);
  const callSheets = getPacketCallSheetsForScope(packet, scope);

  return {
    packet,
    scope,
    callSheets,
    completedCallCount,
    includeCallDetails: scope !== 'summary',
    generatedAt: new Date()
  };
};

const renderAttendantPacketPdfHtml = async (viewModel) => {
  const templatePath = path.join(__dirname, 'views', 'attendant-packet-pdf.ejs');
  return ejs.renderFile(templatePath, viewModel, { async: true });
};

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
};

const resolvePuppeteerExecutablePath = () => {
  const candidatePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ].filter(Boolean);

  return candidatePaths.find(candidatePath => fs.existsSync(candidatePath)) || null;
};

const generatePdfBufferFromHtml = async (html) => {
  console.log('[Attendant PDF] Launching browser for PDF generation');

  const executablePath = resolvePuppeteerExecutablePath();
  if (executablePath) {
    console.log(`[Attendant PDF] Using browser executable: ${executablePath}`);
  } else {
    console.log('[Attendant PDF] No explicit browser executable found. Falling back to Puppeteer default.');
  }

  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ];

  const launchProfiles = [
    {
      name: 'system-chromium-primary',
      executablePath,
      args: baseArgs
    },
    {
      name: 'system-chromium-minimal',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    },
    {
      name: 'puppeteer-default',
      executablePath: null,
      args: baseArgs
    }
  ].filter(profile => profile.executablePath || profile.name === 'puppeteer-default');

  let lastError = null;

  for (const profile of launchProfiles) {
    const launchOptions = {
      headless: true,
      timeout: 30000,
      args: profile.args
    };

    if (profile.executablePath) {
      launchOptions.executablePath = profile.executablePath;
    }

    let browser;
    try {
      console.log(`[Attendant PDF] Launch attempt: ${profile.name}`);
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(30000);
      console.log('[Attendant PDF] Rendering HTML into browser page');
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[Attendant PDF] Generating PDF buffer');
      const rawPdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        timeout: 30000,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });
      const pdfBuffer = Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);
      console.log(`[Attendant PDF] Launch profile succeeded: ${profile.name}`);
      return pdfBuffer;
    } catch (err) {
      lastError = err;
      const message = err && err.message ? err.message : String(err);
      console.error(`[Attendant PDF] Launch profile failed (${profile.name}): ${message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  throw lastError || new Error('Unable to generate PDF with available browser launch profiles.');
};

const renderAttendantPacketView = async (req, res, template) => {
  try {
    const isPacketManager = canManageAttendantPackets(req.user);
    const packetFilter = isPacketManager
      ? {}
      : { candidate: req.user._id };

    let packets = await AttendantPacket.find(packetFilter)
      .populate('candidate', 'displayName email')
      .populate('sponsoringRescueOfficer', 'displayName email')
      .populate('rescueChief', 'displayName email')
      .sort('-updatedAt')
      .limit(100);

    const packetId = req.query.packet;
    let selectedPacket = packetId
      ? packets.find(packet => packet._id.toString() === packetId)
      : packets[0];

    if (packetId && !selectedPacket && mongoose.Types.ObjectId.isValid(packetId)) {
      const extraPacket = await AttendantPacket.findById(packetId)
        .populate('candidate', 'displayName email')
        .populate('sponsoringRescueOfficer', 'displayName email')
        .populate('rescueChief', 'displayName email');

      if (extraPacket && hasAttendantPacketAccess(extraPacket, req.user)) {
        selectedPacket = extraPacket;
        packets = [extraPacket, ...packets];
      }
    }

    const attendantProgress = await AttendantProgress.findOne({ user: req.user._id });
    const completedCalls = selectedPacket
      ? selectedPacket.callSheets.filter(call => call.status === 'completed').length
      : (attendantProgress ? attendantProgress.completedCalls : 0);

    const users = isPacketManager
      ? await User.find({}).sort('displayName').select('displayName email roles')
      : [];

    res.render(template, {
      user: req.user,
      packet: selectedPacket || null,
      packets,
      users,
      isPacketManager,
      canCreatePacket: canCreatePacket(req.user),
      canEvaluateCallSheet: canEvaluateCallSheet(req.user),
      canRescueOfficerSign: canRescueOfficerSign(req.user),
      canPerformFinalReview: canPerformFinalReview(req.user),
      ratings: ['S', 'NI', 'F', 'NA'],
      calls: attendantProgress ? attendantProgress.calls : null,
      completedCalls
    });
  } catch (err) {
    console.error('Error loading attendant packet:', err);
    res.status(500).render('error', { message: 'Error loading attendant packet' });
  }
};

app.get(['/qualifications/attendant-packet', '/demo/attendant-packet'], isAuthenticated, async (req, res) => {
  await renderAttendantPacketView(req, res, 'attendant-packet');
});

app.get('/demo/attendant-packet-old', isAuthenticated, async (req, res) => {
  await renderAttendantPacketView(req, res, 'attendant-packet-old');
});

app.get('/training/attendant-packets/:id/pdf', isAuthenticated, async (req, res) => {
  try {
    console.log(`[Attendant PDF] Request received for packet ${req.params.id}`);
    const requestedScope = (req.query.scope || 'full').toString().toLowerCase();
    const scope = VALID_PACKET_PDF_SCOPES.includes(requestedScope) ? requestedScope : null;
    if (!scope) {
      return res.status(400).render('error', {
        message: `Invalid scope. Allowed values: ${VALID_PACKET_PDF_SCOPES.join(', ')}`
      });
    }

    const packet = await AttendantPacket.findById(req.params.id)
      .populate('candidate', 'displayName email')
      .populate('sponsoringRescueOfficer', 'displayName email')
      .populate('rescueChief', 'displayName email')
      .populate('callSheets.evaluatorId', 'displayName email')
      .populate('callSheets.rescueOfficerId', 'displayName email')
      .populate('finalReview.rescueChiefSignature.signedBy', 'displayName email');

    if (!packet) {
      return res.status(404).render('error', { message: 'Attendant packet not found.' });
    }

    if (!hasAttendantPacketAccess(packet, req.user)) {
      return res.status(403).render('error', { message: 'Access denied.' });
    }

    const viewModel = buildPacketPdfViewModel(packet, scope);
    const html = await renderAttendantPacketPdfHtml(viewModel);
    console.log(`[Attendant PDF] HTML rendered for packet ${req.params.id}; scope=${scope}`);
    const pdfBuffer = await withTimeout(
      generatePdfBufferFromHtml(html),
      45000,
      'Timed out while generating PDF (45s limit reached).'
    );

    if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 5 || pdfBuffer.slice(0, 5).toString() !== '%PDF-') {
      throw new Error('Generated file is not a valid PDF payload.');
    }

    const filename = buildPacketPdfFilename(packet, scope);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    console.log(`[Attendant PDF] PDF generated successfully for packet ${req.params.id}`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating attendant packet PDF:', err);
    return res.status(500).render('error', { message: 'Error generating packet PDF' });
  }
});

app.post(['/qualifications/attendant-packet/cover', '/demo/attendant-packet/cover'], isAuthenticated, async (req, res) => {
  try {
    if (!canCreatePacket(req.user)) {
      return res.status(403).json({ success: false, error: 'Only officers can create or edit packets.' });
    }

    const {
      packetId,
      candidateId,
      sponsoringRescueOfficerId,
      rescueChiefId,
      emtCompletionDate,
      secondAttendantStartDate,
      eligibilityPath,
      qualifiedElsewhereAgency
    } = req.body;

    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'Candidate is required.' });
    }

    const validPaths = ['trips', 'one_year', 'qualified_elsewhere'];
    const chosenPath = validPaths.includes(eligibilityPath) ? eligibilityPath : 'trips';

    const createNewRequested = req.body.createNew === true || req.body.createNew === 'true' || req.body.createNew === '1';
    let packet;
    if (packetId) {
      packet = await AttendantPacket.findById(packetId);
      if (!packet) {
        return res.status(404).json({ success: false, error: 'Packet not found.' });
      }

      const existingCandidateId = packet.candidate ? packet.candidate.toString() : '';
      if (createNewRequested || (candidateId && existingCandidateId && existingCandidateId !== candidateId.toString())) {
        packet = null;
      }
    }

    if (!packet) {
      const existingPacket = await AttendantPacket.findOne({
        candidate: candidateId,
        status: { $in: BLOCK_DUPLICATE_ATTENDANT_PACKET_STATUSES }
      }).select('_id status');

      if (existingPacket) {
        return res.status(400).json({
          success: false,
          error: 'This candidate already has an attendant packet in progress or completed.'
        });
      }

      packet = new AttendantPacket({
        candidate: candidateId,
        createdBy: req.user._id,
        sponsoringRescueOfficer: sponsoringRescueOfficerId || req.user._id,
        callSheets: buildDefaultCallSheets()
      });
    }

    packet.candidate = candidateId;
    packet.sponsoringRescueOfficer = sponsoringRescueOfficerId || req.user._id;
    packet.rescueChief = rescueChiefId || null;
    packet.emtCompletionDate = parseDateOrNull(emtCompletionDate);
    packet.secondAttendantStartDate = parseDateOrNull(secondAttendantStartDate);
    packet.eligibilityPath = chosenPath;
    packet.qualifiedElsewhereAgency = chosenPath === 'qualified_elsewhere'
      ? (qualifiedElsewhereAgency || '').trim()
      : '';

    if (!Array.isArray(packet.callSheets) || packet.callSheets.length === 0) {
      packet.callSheets = buildDefaultCallSheets();
    }

    if (chosenPath !== 'trips') {
      packet.status = 'pending_chief_review';
    }

    await packet.save();
    return res.json({ success: true, packetId: packet._id });
  } catch (err) {
    console.error('Error saving attendant packet cover:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get(['/qualifications/attendant-packet/:id', '/demo/attendant-packet/:id'], isAuthenticated, async (req, res) => {
  try {
    const packet = await AttendantPacket.findById(req.params.id)
      .populate('candidate', 'displayName email')
      .populate('sponsoringRescueOfficer', 'displayName email')
      .populate('rescueChief', 'displayName email');

    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    if (!hasAttendantPacketAccess(packet, req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    return res.json({ success: true, packet });
  } catch (err) {
    console.error('Error loading packet details:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/qualifications/attendant-packet/:id/calls/:callNumber', '/demo/attendant-packet/:id/calls/:callNumber'], isAuthenticated, async (req, res) => {
  try {
    if (!canEvaluateCallSheet(req.user)) {
      return res.status(403).json({ success: false, error: 'Only evaluators/officers can update call sheets.' });
    }

    const packet = await AttendantPacket.findById(req.params.id);
    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    const callSheet = findCallSheet(packet, req.params.callNumber);
    if (!callSheet) {
      return res.status(404).json({ success: false, error: 'Call sheet not found.' });
    }

    const payload = req.body || {};
    callSheet.candidateName = (payload.candidateName || callSheet.candidateName || '').trim();
    callSheet.incidentDate = parseDateOrNull(payload.incidentDate);
    callSheet.patientPriority = (payload.patientPriority || '').trim();
    callSheet.incidentType = (payload.incidentType || '').trim();
    callSheet.fcIncidentNumber = (payload.fcIncidentNumber || '').trim();
    callSheet.directions = (payload.directions || '').trim();
    callSheet.evaluatorComments = (payload.evaluatorComments || '').trim();
    callSheet.independentFieldReady = {
      value: ['yes', 'no', 'not_evaluated'].includes(payload.independentFieldReady) ? payload.independentFieldReady : 'not_evaluated',
      comments: (payload.independentFieldComments || '').trim()
    };

    if (Array.isArray(payload.skillRatings) && payload.skillRatings.length > 0) {
      callSheet.skillRatings = payload.skillRatings.map(entry => ({
        skill: (entry.skill || '').trim(),
        rating: ['S', 'NI', 'F', 'NA'].includes(entry.rating) ? entry.rating : 'NA',
        comments: (entry.comments || '').trim()
      })).filter(entry => entry.skill);
    }

    callSheet.evaluatorId = req.user._id;
    callSheet.candidateSignature = { signedBy: null, signedAt: null, name: '' };
    callSheet.evaluatorSignature = { signedBy: null, signedAt: null, name: '' };
    callSheet.rescueOfficerSignature = { signedBy: null, signedAt: null, name: '' };
    callSheet.status = 'awaiting_candidate_signature';
    callSheet.completedAt = null;

    if (packet.status === 'approved' || packet.status === 'pending_more_evaluation') {
      packet.status = 'in_progress';
      packet.finalReview.decision = 'pending';
    }

    await packet.save();
    return res.json({ success: true, status: callSheet.status });
  } catch (err) {
    console.error('Error saving call sheet:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/qualifications/attendant-packet/:id/calls/:callNumber/candidate-sign', '/demo/attendant-packet/:id/calls/:callNumber/candidate-sign'], isAuthenticated, async (req, res) => {
  try {
    const packet = await AttendantPacket.findById(req.params.id);
    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    if (packet.candidate.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the candidate can sign this section.' });
    }

    const callSheet = findCallSheet(packet, req.params.callNumber);
    if (!callSheet) {
      return res.status(404).json({ success: false, error: 'Call sheet not found.' });
    }

    callSheet.candidateSignature = {
      signedBy: req.user._id,
      signedAt: new Date(),
      name: req.user.displayName || req.user.email
    };
    callSheet.status = 'awaiting_evaluator_signature';
    await packet.save();

    return res.json({ success: true, status: callSheet.status });
  } catch (err) {
    console.error('Error candidate-signing call sheet:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/qualifications/attendant-packet/:id/calls/:callNumber/evaluator-sign', '/demo/attendant-packet/:id/calls/:callNumber/evaluator-sign'], isAuthenticated, async (req, res) => {
  try {
    if (!canEvaluateCallSheet(req.user)) {
      return res.status(403).json({ success: false, error: 'Only evaluators/officers can sign this section.' });
    }

    const packet = await AttendantPacket.findById(req.params.id);
    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    const callSheet = findCallSheet(packet, req.params.callNumber);
    if (!callSheet) {
      return res.status(404).json({ success: false, error: 'Call sheet not found.' });
    }

    callSheet.evaluatorSignature = {
      signedBy: req.user._id,
      signedAt: new Date(),
      name: req.user.displayName || req.user.email
    };
    callSheet.status = 'awaiting_rescue_officer_signature';
    await packet.save();

    return res.json({ success: true, status: callSheet.status });
  } catch (err) {
    console.error('Error evaluator-signing call sheet:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/qualifications/attendant-packet/:id/calls/:callNumber/rescue-officer-sign', '/demo/attendant-packet/:id/calls/:callNumber/rescue-officer-sign'], isAuthenticated, async (req, res) => {
  try {
    if (!canRescueOfficerSign(req.user)) {
      return res.status(403).json({ success: false, error: 'Only rescue officers can sign this section.' });
    }

    const packet = await AttendantPacket.findById(req.params.id);
    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    const callSheet = findCallSheet(packet, req.params.callNumber);
    if (!callSheet) {
      return res.status(404).json({ success: false, error: 'Call sheet not found.' });
    }

    callSheet.rescueOfficerId = req.user._id;
    callSheet.rescueOfficerSignature = {
      signedBy: req.user._id,
      signedAt: new Date(),
      name: req.user.displayName || req.user.email
    };
    callSheet.status = 'completed';
    callSheet.completedAt = new Date();

    const completedCount = packet.callSheets.filter(call => call.status === 'completed').length;
    if (packet.eligibilityPath === 'trips' && completedCount >= 12) {
      packet.status = 'pending_chief_review';
    }

    await packet.save();
    await syncAttendantProgressFromPacket(packet);

    return res.json({ success: true, status: callSheet.status, completedCalls: completedCount });
  } catch (err) {
    console.error('Error officer-signing call sheet:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/qualifications/attendant-packet/:id/final-review', '/demo/attendant-packet/:id/final-review'], isAuthenticated, async (req, res) => {
  try {
    if (!canPerformFinalReview(req.user)) {
      return res.status(403).json({ success: false, error: 'Only rescue chief/officer roles can complete final review.' });
    }

    const packet = await AttendantPacket.findById(req.params.id);
    if (!packet) {
      return res.status(404).json({ success: false, error: 'Packet not found.' });
    }

    const decision = ['approved', 'pending_more_evaluation'].includes(req.body.decision)
      ? req.body.decision
      : 'pending_more_evaluation';

    packet.finalReview.decision = decision;
    packet.finalReview.comments = (req.body.comments || '').trim();
    packet.finalReview.firstAttendantCompletionDate = parseDateOrNull(req.body.firstAttendantCompletionDate) || new Date();
    packet.finalReview.rescueChiefSignature = {
      signedBy: req.user._id,
      signedAt: new Date(),
      name: req.user.displayName || req.user.email
    };

    if (decision === 'approved') {
      packet.status = 'approved';
      await awardAttendantQualificationForUser(packet.candidate, req.user._id);
    } else {
      packet.status = 'pending_more_evaluation';
    }

    await packet.save();
    return res.json({ success: true, status: packet.status });
  } catch (err) {
    console.error('Error saving final review:', err);
    return res.status(500).json({ success: false, error: err.message });
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

    await awardAttendantQualificationForUser(req.user._id, req.user._id);
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
    await AttendantPacket.deleteMany({ candidate: userId });

    res.json({ success: true });
  } catch (err) {
    console.error('Error removing attendant qualification:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// User role management
app.post(['/user-management/update-user/:id', '/admin/update-user/:id'], isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { roles } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    user.roles = normalizeRoles(roles);
    await user.save();
    
    res.redirect('/user-management?success=User roles updated successfully');
  } catch (err) {
    console.error('Error updating user roles:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error updating user roles'));
  }
});

app.post(['/user-management/update-user-details/:id', '/admin/update-user-details/:id'], isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { firstName, lastName, displayName } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }

    const trimmedFirstName = (firstName || '').trim();
    const trimmedLastName = (lastName || '').trim();
    const trimmedDisplayName = (displayName || '').trim();

    user.firstName = trimmedFirstName;
    user.lastName = trimmedLastName;
    user.displayName = trimmedDisplayName || [trimmedFirstName, trimmedLastName].filter(Boolean).join(' ').trim() || user.email;

    await user.save();

    res.redirect('/user-management?success=User details updated successfully');
  } catch (err) {
    console.error('Error updating user details:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error updating user details'));
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
app.post(['/user-management/toggle-admin/:id', '/admin/toggle-admin/:id'], isAuthenticated, isAdmin, async (req, res) => {
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

// Delete user
app.post(['/user-management/delete-user/:id', '/admin/delete-user/:id'], isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }

    // Don't allow deleting the primary admin account
    if (user.email === 'adavis@bvar19.org') {
      return res.redirect('/user-management?error=Cannot delete the primary administrator');
    }

    await User.deleteOne({ _id: user._id });

    res.redirect('/user-management?success=User deleted successfully');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.redirect('/user-management?error=' + encodeURIComponent(err.message || 'Error deleting user'));
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