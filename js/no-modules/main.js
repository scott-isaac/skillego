// main.js - Entry point for the application

// Initialize the game when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    
    try {
        // Initialize AI learning system if available
        if (typeof aiLearning !== 'undefined') {
            console.log('Initializing AI learning system...');
            aiLearning.init();
            setupAIStatistics();
        }
        
        // Initialize the game
        console.log('Starting game initialization...');
        initGame();
        
        console.log('Game initialized successfully');
        debugLog("Game initialized. Ready to play!");
    } catch (error) {
        console.error('Error in game initialization:', error);
        debugLog("Error during initialization: " + error.message);
    }
});

// Set up the AI Statistics UI and button handlers
function setupAIStatistics() {
    // Show the AI stats section if it exists
    const aiStatsSection = document.getElementById('ai-stats');
    if (aiStatsSection) {
        aiStatsSection.style.display = 'block';
    }
    
    // Update stats display
    updateAIStats();
    
    // Set up the reset button
    const resetAIButton = document.getElementById('reset-ai-learning');
    if (resetAIButton) {
        resetAIButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset all CPU learning? This cannot be undone.')) {
                aiLearning.resetLearning();
                updateAIStats();
                debugLog("AI learning system has been reset to default values");
            }
        });
    }
    
    // Update stats every 60 seconds to reflect any changes
    setInterval(updateAIStats, 60000);
}

// Update the AI statistics display
function updateAIStats() {
    if (typeof aiLearning === 'undefined') return;
    
    const stats = aiLearning.getLearningSummary();
    
    // Update each stat element if it exists
    const elements = {
        'games-played': stats.gamesPlayed,
        'win-rate': `${stats.winRate}%`,
        'ai-intelligence': `${stats.confidence}%`,
        'most-valued-piece': `${stats.mostValued.type} (${stats.mostValued.value.toFixed(2)}x)`,
        'least-valued-piece': `${stats.leastValued.type} (${stats.leastValued.value.toFixed(2)}x)`
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}
