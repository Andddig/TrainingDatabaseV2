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
        const classes = await MfriClass.find({ region }).sort({ startDate: 1 });
        res.render('find-class', { classes, region, user: req.user });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).render('error', { message: 'Error fetching classes' });
    }
});

// Function to scrape MFRI website for classes
async function scrapeMfriClasses() {
    try {
        const response = await axios.get('https://www.mfri.org/office/ncrtc/');
        const $ = cheerio.load(response.data);
        const classes = [];

        // Find all h2 elements (course titles)
        $('h2').each((i, element) => {
            const courseBlock = $(element);
            const title = courseBlock.text().trim().replace('More →', '').trim();
            
            // Get the next div containing course details
            const detailsBlock = courseBlock.next('div');
            
            // Extract course ID
            const courseIdElem = detailsBlock.find('h5').first();
            const courseId = courseIdElem.text().trim().split('-').slice(0, 3).join('-');
            
            // Extract dates
            const datesText = detailsBlock.find('h5').eq(1).text().trim();
            const [startDateStr, endDateStr] = datesText.split(' - ');
            const startDate = new Date(startDateStr);
            const endDate = new Date(endDateStr);
            
            // Extract class times
            const firstClassTimeText = detailsBlock.find('h5').eq(2).text().trim();
            const [timeStr] = firstClassTimeText.split('First Class Time: ');
            const [startTime, endTime] = timeStr.split(' - ').map(t => t.trim());
            
            // Extract location
            const locationElem = detailsBlock.find('h5').eq(3);
            const location = locationElem.text().trim();
            
            // Extract registration dates
            const regDatesText = detailsBlock.find('h5').eq(4).text().trim();
            const [regOpenStr, regCloseStr] = regDatesText.split(' - ');
            const registrationOpen = new Date(regOpenStr.replace('Registration Open: ', ''));
            const registrationClose = new Date(regCloseStr.replace('Registration Close: ', ''));
            
            // Extract instructional hours
            const hoursText = detailsBlock.prev().find('h5').first().text();
            const hours = parseFloat(hoursText.match(/Instructional Hours: (\d+\.\d+)/)?.[1] || '0');

            // Create class object
            classes.push({
                title,
                courseId,
                region: 'North Central',
                startDate,
                endDate,
                classTimes: [{
                    day: 'See description',
                    startTime,
                    endTime
                }],
                location,
                registrationOpen,
                registrationClose,
                instructionalHours: hours,
                registrationUrl: `https://www.mfri.org/office/ncrtc/#${courseId}`
            });
        });

        // Update database with new classes
        for (const classData of classes) {
            if (classData.courseId && classData.title) {  // Only add if we have valid data
                await MfriClass.findOneAndUpdate(
                    { courseId: classData.courseId },
                    classData,
                    { upsert: true, new: true }
                );
            }
        }

        console.log('Successfully updated MFRI classes');
    } catch (error) {
        console.error('Error scraping MFRI classes:', error);
    }
}

// Schedule daily updates
setInterval(scrapeMfriClasses, 24 * 60 * 60 * 1000); // Run every 24 hours
// Run initial scrape
scrapeMfriClasses();

module.exports = router; 