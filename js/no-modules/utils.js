// utils.js - Utility functions

// Add a debug log function
function debugLog(message) {
    const debugContent = document.getElementById('debug-content');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    debugContent.prepend(logEntry);
    
    // Keep log size manageable
    if (debugContent.children.length > 20) {
        debugContent.removeChild(debugContent.lastChild);
    }
}
