const express = require('express');
const router = express.Router();
const MfriClass = require('../models/mfriClass');
const TrainingSubmission = require('../models/TrainingSubmission');
const TrainingClass = require('../models/TrainingClass');
const axios = require('axios');
const cheerio = require('cheerio');

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

// Route to display all classes
router.get('/find-class', isAuthenticated, async (req, res) => {
    // Initialize debug info early
    let debugInfo = {
        registrationFilterParam: req.query.showClosedRegistration,
        classesBeforeRegistrationFilter: 0,
        filterApplied: 'none',
        classesAfterRegistrationFilter: 0,
        sampleFilterDecisions: [],
        currentTime: new Date().toISOString(),
        queryParams: req.query
    };
    
    console.log('=== FIND CLASS DEBUG START ===');
    console.log('Query parameters:', req.query);
    console.log('showClosedRegistration param:', req.query.showClosedRegistration);
    console.log('Current time:', debugInfo.currentTime);
    
    try {
        const region = req.query.region || 'North Central';
        const searchQuery = {};
        
        // Add region filter
        searchQuery.region = region;
        
        // Add location search if provided
        if (req.query.location) {
            searchQuery.location = { $regex: req.query.location, $options: 'i' };
        }
        
        // Add course type search if provided
        if (req.query.courseType) {
            searchQuery.courseId = { $regex: `^${req.query.courseType}-`, $options: 'i' };
        }
        
        // Add title search if provided
        if (req.query.title) {
            searchQuery.title = { $regex: req.query.title, $options: 'i' };
        }
        
        // Add date range search if provided
        if (req.query.startDate) {
            searchQuery.startDate = { $gte: new Date(req.query.startDate) };
        }
        if (req.query.endDate) {
            searchQuery.endDate = { $lte: new Date(req.query.endDate) };
        }
        
        let classes = await MfriClass.find(searchQuery).sort({ startDate: 1 });
        const totalClassesBeforeFilter = classes.length;
        let filteredCount = 0;
        let expiredCount = 0;
        
        // Filter out expired classes (classes that have already ended)
        const now = new Date();
        const classesBeforeExpiredFilter = classes.length;
        classes = classes.filter(cls => {
            return new Date(cls.endDate) >= now; // Keep classes that haven't ended yet
        });
        expiredCount = classesBeforeExpiredFilter - classes.length;
        
        // Filter based on registration status if requested
        debugInfo.classesBeforeRegistrationFilter = classes.length;
        
        if (req.query.showClosedRegistration === 'only') {
            debugInfo.filterApplied = 'closed registration only';
            // Show only classes where registration is closed but class hasn't started
            classes = classes.filter((cls, index) => {
                const regCloseDate = new Date(cls.registrationClose);
                const startDate = new Date(cls.startDate);
                const isRegCloseDateValid = !isNaN(regCloseDate.getTime());
                const isStartDateValid = !isNaN(startDate.getTime());
                const isRegClosed = isRegCloseDateValid && regCloseDate < now;
                const hasNotStarted = isStartDateValid && startDate > now;
                const shouldKeep = isRegClosed && hasNotStarted;
                
                // Store sample decisions for debugging (first 5)
                if (index < 5) {
                    debugInfo.sampleFilterDecisions.push({
                        courseId: cls.courseId,
                        registrationClose: cls.registrationClose,
                        startDate: cls.startDate,
                        currentTime: now.toISOString(),
                        isRegCloseDateValid,
                        isStartDateValid,
                        isRegClosed,
                        hasNotStarted,
                        shouldKeep
                    });
                }
                
                return shouldKeep;
            });
        } else if (!req.query.showClosedRegistration || req.query.showClosedRegistration === '') {
            debugInfo.filterApplied = 'open registration only (default)';
            // Default: show only classes where registration is still open
            classes = classes.filter((cls, index) => {
                const regCloseDate = new Date(cls.registrationClose);
                const isRegCloseDateValid = !isNaN(regCloseDate.getTime());
                // Only keep classes where registration is still open (future date) or no reg date exists
                const shouldKeep = !isRegCloseDateValid || regCloseDate >= now;
                
                // Store sample decisions for debugging (first 5)
                if (index < 5) {
                    debugInfo.sampleFilterDecisions.push({
                        courseId: cls.courseId,
                        registrationClose: cls.registrationClose,
                        regCloseDate: isRegCloseDateValid ? regCloseDate.toISOString() : 'Invalid Date',
                        currentTime: now.toISOString(),
                        isRegCloseDateValid,
                        isRegInFuture: isRegCloseDateValid ? regCloseDate >= now : false,
                        shouldKeep
                    });
                }
                
                return shouldKeep;
            });
        } else {
            debugInfo.filterApplied = 'show all classes';
        }
        
        debugInfo.classesAfterRegistrationFilter = classes.length;
        
        console.log('=== REGISTRATION FILTER RESULTS ===');
        console.log(`Filter applied: ${debugInfo.filterApplied}`);
        console.log(`Classes before registration filter: ${debugInfo.classesBeforeRegistrationFilter}`);
        console.log(`Classes after registration filter: ${debugInfo.classesAfterRegistrationFilter}`);
        console.log('Sample filter decisions:', debugInfo.sampleFilterDecisions);
        console.log('=====================================');
        
        // Filter out completed classes unless user specifically wants to see them
        if (!req.query.showCompleted) {
            const approvedSubmissions = await TrainingSubmission.find({
                student: req.user._id,
                status: 'approved'
            }).populate('trainingClass');
            
            // Get the names of completed training classes
            const completedClassNames = approvedSubmissions.map(submission => 
                submission.trainingClass.name.toLowerCase()
            );
            
            // Filter out MFRI classes that match completed training class names
            const filteredClasses = classes.filter(mfriClass => {
                const mfriClassName = mfriClass.title.toLowerCase();
                // Check if this MFRI class matches any completed training class
                return !completedClassNames.some(completedName => 
                    mfriClassName.includes(completedName) || completedName.includes(mfriClassName)
                );
            });
            
            filteredCount = classes.length - filteredClasses.length;
            classes = filteredClasses;
        }
        
        // Get unique locations for the filter dropdown
        const locations = [...new Set(classes.map(c => c.location))].sort();
        
        // Get unique course types for the filter dropdown
        const courseTypes = [...new Set(classes.map(c => c.courseId.split('-')[0]))].sort();
        
        res.render('find-class', { 
            classes, 
            region, 
            user: req.user,
            locations,
            courseTypes,
            searchParams: req.query,
            totalClassesBeforeFilter,
            filteredCount: filteredCount || 0,
            expiredCount: expiredCount || 0,
            debugInfo
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).render('error', { 
            message: 'Error fetching classes',
            debugInfo: debugInfo || null
        });
    }
});

router.get('/debug-classes', isAuthenticated, async (req, res) => {
    const classes = await MfriClass.find().sort({ startDate: 1 });
    const now = new Date();
    
    // Add debug info to each class
    const debugClasses = classes.map(cls => ({
        courseId: cls.courseId,
        title: cls.title,
        startDate: cls.startDate,
        endDate: cls.endDate,
        registrationClose: cls.registrationClose,
        registrationCloseDate: new Date(cls.registrationClose),
        isRegCloseDateValid: !isNaN(new Date(cls.registrationClose).getTime()),
        isRegClosed: !isNaN(new Date(cls.registrationClose).getTime()) && new Date(cls.registrationClose) < now,
        isRegOpen: isNaN(new Date(cls.registrationClose).getTime()) || new Date(cls.registrationClose) >= now,
        hasStarted: !isNaN(new Date(cls.startDate).getTime()) && new Date(cls.startDate) <= now,
        hasEnded: !isNaN(new Date(cls.endDate).getTime()) && new Date(cls.endDate) < now
    }));
    
    res.json({
        currentTime: now,
        queryParams: req.query,
        totalClasses: classes.length,
        debugClasses: debugClasses.slice(0, 10) // Show first 10 for debugging
    });
});

// Function to scrape MFRI website for classes
async function scrapeMfriClasses() {
    try {
        console.log('Starting MFRI class scraping...');
        const response = await axios.get('https://www.mfri.org/office/ncrtc/');
        const $ = cheerio.load(response.data);

        const classes = [];
        const courseInfoCache = {}; // Cache for course titles and hours
        
        // Find all course items (they are in div.row.event-item)
        $('.row.event-item').each((i, element) => {
            try {
                const courseSection = $(element);
                
                // Get course title and registration link from the h2 element
                const titleElement = courseSection.find('h2.bold.red').first();
                const title = titleElement.text().trim().split(' More →')[0].trim();
                
                // Get instructional hours - look in all h5 elements for the hours
                let instructionalHours = 0;
                courseSection.find('h5.mt-2.body-color').each((i, el) => {
                    const text = $(el).text().trim();
                    const hoursMatch = text.match(/Instructional Hours: (\d+\.?\d*)/);
                    if (hoursMatch) {
                        instructionalHours = parseFloat(hoursMatch[1]);
                    }
                });

                // Find all course instances under this title
                courseSection.find('.col-md-2 h5.body-color').each((i, courseInstance) => {
                    const courseIdElement = $(courseInstance);
                    const courseId = courseIdElement.text().trim().split('\n')[0];
                    
                    // Extract course prefix (e.g., EMS-202 from EMS-202-S025-2025)
                    const coursePrefix = courseId.split('-').slice(0, 2).join('-');
                    
                    // Cache the title and hours for this course prefix if not already cached
                    if (!courseInfoCache[coursePrefix]) {
                        courseInfoCache[coursePrefix] = {
                            title,
                            instructionalHours
                        };
                    }
                    
                    // Get the corresponding date/time and location for this instance
                    const dateTimeElement = courseIdElement.closest('.row').find('.col-md-3 h5.mt-2.body-color').first();
                    const dateTimeText = dateTimeElement.text();
                    
                    const startDate = new Date(dateTimeText.match(/Start Date: (\d{2}-\d{2}-\d{4})/)?.[1]);
                    const endDate = new Date(dateTimeText.match(/End Date: (\d{2}-\d{2}-\d{4})/)?.[1]);
                    
                    const timeMatch = dateTimeText.match(/First Class Time: (\d{2}:\d{2}) - (\d{2}:\d{2})/);
                    const startTime = timeMatch?.[1];
                    const endTime = timeMatch?.[2];
                    
                    // Get registration dates
                    const regElement = courseIdElement.closest('.row').find('.col-md-3 h5.mt-2.body-color').eq(1);
                    const regText = regElement.text();
                    const registrationOpen = new Date(regText.match(/Registration Open: (\d{2}-\d{2}-\d{4})/)?.[1]);
                    const registrationClose = new Date(regText.match(/Registration Close: (\d{2}-\d{2}-\d{4})/)?.[1]);
                    
                    // Get location
                    const locationElement = courseIdElement.closest('.row').find('.col-md-4 h5.mt-2.body-color').first();
                    const location = locationElement.text().trim().split(' More →')[0];
                    
                    // Get days of the week
                    const daysText = dateTimeElement.find('span').text().trim();
                    
                    // Only add valid courses
                    if (courseId && !isNaN(startDate) && !isNaN(endDate)) {
                        console.log('Adding course:', {
                            title: courseInfoCache[coursePrefix].title,
                            courseId,
                            startDate: startDate.toISOString(),
                            endDate: endDate.toISOString(),
                            location,
                            instructionalHours: courseInfoCache[coursePrefix].instructionalHours
                        });
                        
                        classes.push({
                            title: courseInfoCache[coursePrefix].title,
                            courseId,
                            region: 'North Central',
                            startDate,
                            endDate,
                            classTimes: [{
                                day: daysText,
                                startTime: startTime || 'See description',
                                endTime: endTime || 'See description'
                            }],
                            location: location || 'See description',
                            registrationOpen,
                            registrationClose,
                            instructionalHours: courseInfoCache[coursePrefix].instructionalHours,
                            registrationUrl: `https://www.mfri.org/register/${courseId}/msfs/ncrtc`
                        });
                    }
                });
            } catch (err) {
                console.error('Error processing course:', err);
            }
        });

        console.log(`Found ${classes.length} classes`);

        // Update database with new classes
        for (const classData of classes) {
            try {
                await MfriClass.findOneAndUpdate(
                    { courseId: classData.courseId },
                    classData,
                    { upsert: true, new: true }
                );
            } catch (err) {
                console.error('Error updating class in database:', err);
            }
        }

        console.log('Successfully updated MFRI classes');
    } catch (error) {
        console.error('Error scraping MFRI classes:', error);
    }
}

// Run initial scrape immediately
scrapeMfriClasses();

// Schedule daily updates - run every 24 hours
setInterval(scrapeMfriClasses, 24 * 60 * 60 * 1000);

// Manual refresh endpoint for testing (remove in production)
router.get('/refresh-classes', isAuthenticated, async (req, res) => {
    try {
        await scrapeMfriClasses();
        res.redirect('/mfri/find-class');
    } catch (error) {
        console.error('Error refreshing classes:', error);
        res.status(500).render('error', { message: 'Error refreshing classes' });
    }
});

router.get('/class/:courseId', isAuthenticated, async (req, res) => {
    try {
        const classData = await MfriClass.findOne({ courseId: req.params.courseId });
        if (!classData) {
            return res.status(404).render('error', { message: 'Class not found' });
        }
        res.render('class-details', { classData, user: req.user });
    } catch (error) {
        console.error('Error fetching class details:', error);
        res.status(500).render('error', { message: 'Error fetching class details' });
    }
});

module.exports = router; 