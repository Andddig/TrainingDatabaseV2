const express = require('express');
const router = express.Router();
const MfriClass = require('../models/mfriClass');
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
        
        const classes = await MfriClass.find(searchQuery).sort({ startDate: 1 });
        
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
            searchParams: req.query
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).render('error', { message: 'Error fetching classes' });
    }
});

router.get('/debug-classes', isAuthenticated, async (req, res) => {
    const classes = await MfriClass.find().sort({ startDate: 1 });
    res.json(classes);
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