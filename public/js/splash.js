// Splash Screen Animation
document.addEventListener('DOMContentLoaded', function() {
  const splashScreen = document.getElementById('splash-screen');
  const splashCircle = document.getElementById('splash-circle');
  const splashText = document.getElementById('splash-text');
  const mainContent = document.querySelector('.container');
  
  // Time-based messages
  const messages = {
    earlyMorning: [ // 4-7 AM
      "Rise and grind! 🌅 Time to learn something new!",
      "Early bird gets the knowledge! 🐦 Ready to level up?",
      "Dawn patrol! 🌄 Perfect time for some training!",
      "Morning warrior! ⚔️ Let's conquer some classes!"
    ],
    morning: [ // 7-12 PM
      "Good morning! ☀️ Ready to start your day with learning?",
      "Morning energy! ⚡ Time to feed your brain!",
      "Fresh start! 🌱 What will you learn today?",
      "Morning motivation! 💪 Let's make today count!"
    ],
    afternoon: [ // 12-5 PM
      "Afternoon power session! 🔥 Time to level up!",
      "Midday knowledge break! 🧠 Let's get smarter!",
      "Afternoon advancement! 🚀 Ready to excel?",
      "Lunch break learning! 🥪 Feed your mind too!"
    ],
    evening: [ // 5-9 PM
      "Evening excellence! 🌆 Time to wind down with wisdom!",
      "Sunset sessions! 🌅 Perfect time for growth!",
      "Evening elevation! 📈 Let's end the day strong!",
      "Golden hour learning! ✨ You're glowing with potential!"
    ],
    night: [ // 9 PM - 4 AM
      "Night owl alert! 🦉 Perfect time for some late-night learning!",
      "Burning the midnight oil! 🕯️ Your dedication is inspiring!",
      "Late night legend! 🌙 Great minds think after hours!",
      "Midnight mastermind! 🧠 When the world sleeps, you grow!",
      "Nocturnal knowledge seeker! 🦇 The night is young and so is your potential!",
      "Vampire of learning! 🧛‍♂️ Sucking up knowledge while others sleep!"
    ]
  };
  
  // Get current time and select appropriate message
  function getTimeBasedMessage() {
    const now = new Date();
    const hour = now.getHours();
    
    let timeCategory;
    if (hour >= 4 && hour < 7) {
      timeCategory = 'earlyMorning';
    } else if (hour >= 7 && hour < 12) {
      timeCategory = 'morning';
    } else if (hour >= 12 && hour < 17) {
      timeCategory = 'afternoon';
    } else if (hour >= 17 && hour < 21) {
      timeCategory = 'evening';
    } else {
      timeCategory = 'night';
    }
    
    const categoryMessages = messages[timeCategory];
    return categoryMessages[Math.floor(Math.random() * categoryMessages.length)];
  }
  
  // Set the message
  splashText.textContent = getTimeBasedMessage();
  
  // Calculate the size needed to cover the entire screen
  const screenSize = Math.max(window.innerWidth, window.innerHeight) * 2;
  
  // Create a white circle element to go behind the content
  const whiteCircle = document.createElement('div');
  whiteCircle.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: white;
    border-radius: 50%;
    z-index: 9999;
    width: 0;
    height: 0;
  `;
  document.body.appendChild(whiteCircle);
  
  // Initially hide the main content and set it as a tiny circle
  gsap.set(mainContent, {
    scale: 0,
    opacity: 1,
    borderRadius: '50%',
    overflow: 'hidden',
    transformOrigin: 'center center',
    position: 'relative',
    zIndex: 10000 // Make sure content appears above the white circle
  });
  
  // Create the animation timeline
  const tl = gsap.timeline();
  
  // Animation sequence:
  // 1. Start with a tiny blue circle in the center
  // 2. Expand the blue circle to fill the entire screen
  // 3. Show and animate the text
  // 4. Wait a bit with the screen blue and text visible
  // 5. White circle and website content grow together from center, pushing blue away
  // 6. Remove circular mask and splash screen
  tl.set(splashCircle, {
    width: 0,
    height: 0
  })
  .to(splashCircle, {
    width: screenSize,
    height: screenSize,
    duration: 1.2,
    ease: "power2.out"
  })
  .to(splashText, {
    opacity: 1,
    duration: 0.8,
    ease: "power2.out",
    onComplete: () => {
      splashText.classList.add('text-shadow-pop-tr');
    }
  }, "-=0.3")
  .to({}, { duration: 3 }) // Wait 3 seconds with text visible (increased from 1.5)
  .to(splashText, {
    opacity: 0,
    duration: 0.6,
    ease: "power2.inOut"
  })
  .to(whiteCircle, {
    width: screenSize,
    height: screenSize,
    duration: 1.5,
    ease: "power2.out"
  })
  .to(mainContent, {
    scale: 1,
    duration: 1.5,
    ease: "power2.out"
  }, "-=1.5") // Start content scaling at the same time aAs white circle expansion
  .to(mainContent, {
    borderRadius: '0%',
    duration: 0.5,
    ease: "power2.out",
    onComplete: () => {
      // Remove the splash screen and white circle after content animation completes
      splashScreen.style.display = 'none';
      whiteCircle.remove();
    }
  }, "-=0.5");
}); 