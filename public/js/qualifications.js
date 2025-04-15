/**
 * Qualifications Management JavaScript
 */
document.addEventListener('DOMContentLoaded', function() {
    // Handle "Show Required Classes" toggle button
    const toggleClassesBtns = document.querySelectorAll('.toggle-classes-btn');
    
    toggleClassesBtns.forEach(toggleBtn => {
        const requiredClasses = toggleBtn.nextElementSibling;
        
        if (requiredClasses && requiredClasses.classList.contains('required-classes')) {
            // Hide classes by default - force it to be hidden
            requiredClasses.style.display = 'none';
            requiredClasses.classList.remove('visible');
            
            toggleBtn.addEventListener('click', function() {
                requiredClasses.classList.toggle('visible');
                
                // Update display style directly
                if (requiredClasses.classList.contains('visible')) {
                    requiredClasses.style.display = 'block';
                } else {
                    requiredClasses.style.display = 'none';
                }
                
                // Update button text based on visibility
                const buttonIcon = this.querySelector('i');
                const buttonText = this.querySelector('span');
                
                if (requiredClasses.classList.contains('visible')) {
                    buttonText.textContent = 'Hide Required Classes';
                    buttonIcon.className = 'fas fa-chevron-up';
                } else {
                    buttonText.textContent = 'Show Required Classes';
                    buttonIcon.className = 'fas fa-chevron-down';
                }
            });
        }
    });
    
    // Qualification sorting functionality
    const sortOptions = document.querySelectorAll('.sort-option');
    const sortOrder = document.querySelector('.sort-order');
    const qualificationsList = document.querySelector('.qualifications-list');
    
    if (sortOptions.length && qualificationsList) {
        // Keep track of current sort state
        let currentSort = 'name'; // Default sort by name
        let isAscending = true;   // Default ascending order
        
        // Set initial active sort option
        sortOptions.forEach(option => {
            if (option.dataset.sort === currentSort) {
                option.classList.add('active');
            }
            
            option.addEventListener('click', function() {
                // Update active state
                sortOptions.forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                
                // Update current sort
                currentSort = this.dataset.sort;
                
                // Sort qualifications
                sortQualifications();
            });
        });
        
        // Toggle sort order
        if (sortOrder) {
            sortOrder.addEventListener('click', function() {
                isAscending = !isAscending;
                
                // Update icon
                const icon = this.querySelector('i');
                if (isAscending) {
                    icon.className = 'fas fa-sort-up';
                } else {
                    icon.className = 'fas fa-sort-down';
                }
                
                // Sort qualifications
                sortQualifications();
            });
        }
        
        // Function to sort qualifications
        function sortQualifications() {
            const qualifications = Array.from(qualificationsList.children);
            
            qualifications.sort((a, b) => {
                let valueA, valueB;
                
                switch(currentSort) {
                    case 'name':
                        valueA = a.querySelector('.qualification-title').textContent;
                        valueB = b.querySelector('.qualification-title').textContent;
                        break;
                    case 'date':
                        valueA = a.dataset.date || '';
                        valueB = b.dataset.date || '';
                        break;
                    case 'progress':
                        valueA = parseInt(a.dataset.progress || 0);
                        valueB = parseInt(b.dataset.progress || 0);
                        break;
                    default:
                        valueA = a.querySelector('.qualification-title').textContent;
                        valueB = b.querySelector('.qualification-title').textContent;
                }
                
                // For strings
                if (typeof valueA === 'string' && typeof valueB === 'string') {
                    if (isAscending) {
                        return valueA.localeCompare(valueB);
                    } else {
                        return valueB.localeCompare(valueA);
                    }
                }
                
                // For numbers
                if (isAscending) {
                    return valueA - valueB;
                } else {
                    return valueB - valueA;
                }
            });
            
            // Re-append items in sorted order
            qualifications.forEach(qualification => {
                qualificationsList.appendChild(qualification);
            });
        }
    }
}); 