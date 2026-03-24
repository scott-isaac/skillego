// ai-learning.js - AI learning system for Skillego

// Learning system to help CPU improve over time
const aiLearning = {
    // Current learning weights for each strategy
    weights: {
        // Strategy weights for different situations
        powerDeficitStrategy: {
            uncover: 0.7,             // Base chance to uncover when behind in power
            aggressiveCapture: 0.6,   // Willingness to make risky captures when behind
            strategicValue: 1.5       // Minimum strategic value for a "worthwhile" move
        },
        powerAdvantageStrategy: {
            uncover: 0.3,             // Base chance to uncover when ahead in power
            safeMovePriority: 0.8,    // How much to prioritize safe moves when ahead
            aggressiveCapture: 0.2    // Lower willingness to risk pieces when ahead
        },
        pieceValues: {               // How much to value each piece relatively
            mouse: 1.0,              // Base values, will be adjusted by learning
            cat: 1.0,
            wolf: 1.0,
            bear: 1.0,
            eagle: 1.0,
            dragon: 1.0,
            centerControl: 1.0        // Value of controlling center positions
        },
        dragonProtection: 1.0,        // How much to prioritize protecting dragons
        mouseThreat: 1.0              // How much to prioritize mouse threats
    },

    // Game history for learning
    gameHistory: {
        currentGame: {
            moves: [],               // Stores moves made in current game
            uncovered: [],           // Pieces uncovered in the game
            outcome: null            // 'win', 'loss', or null if game in progress
        },
        previousGames: []            // Will store history of completed games up to a limit
    },

    // Initialize learning system
    init: function() {
        this.loadLearningState();
        console.log("AI Learning system initialized with weights:", this.weights);
    },

    // Record a CPU move for learning
    recordMove: function(moveType, fromPosition, toPosition, capturedPiece, powerDifference) {
        const move = {
            type: moveType, // 'move' or 'uncover'
            timestamp: Date.now(),
            fromPosition: fromPosition ? {...fromPosition} : null,
            toPosition: toPosition ? {...toPosition} : null,
            capturedPiece: capturedPiece ? {...capturedPiece} : null,
            powerDifferenceBeforeMove: powerDifference
        };

        this.gameHistory.currentGame.moves.push(move);
        
        // If it's been more than 10 minutes since the last save, persist the learning state
        this.saveLearningState();
    },

    // Record when a piece is uncovered
    recordUncoveredPiece: function(position, piece) {
        this.gameHistory.currentGame.uncovered.push({
            position: {...position},
            piece: {...piece},
            timestamp: Date.now()
        });
    },

    // Record game outcome and learn from it
    recordGameResult: function(winner) {
        const isWin = winner === gameState.cpuPlayer;
        this.gameHistory.currentGame.outcome = isWin ? 'win' : 'loss';
        
        // Learn from the game result
        this.learnFromGame(this.gameHistory.currentGame, isWin);
        
        // Save current game to history and start a new one
        this.gameHistory.previousGames.unshift(this.gameHistory.currentGame);
        
        // Limit history size to avoid excessive memory use
        if (this.gameHistory.previousGames.length > 20) {
            this.gameHistory.previousGames.pop();
        }
        
        // Reset for new game
        this.gameHistory.currentGame = { moves: [], uncovered: [], outcome: null };
        
        // Save updated learning to localStorage
        this.saveLearningState();
    },

    // Learn from a completed game
    learnFromGame: function(game, isWin) {
        const learningRate = isWin ? 0.05 : 0.08; // Learn faster from losses
        
        // Analyze what worked and what didn't
        this.analyzeMoveEffectiveness(game, learningRate, isWin);
        this.analyzePieceValueEffectiveness(game, learningRate, isWin);
        this.analyzeUncoverStrategy(game, learningRate, isWin);
        
        console.log("AI Learning: Updated weights based on game outcome:", isWin ? "win" : "loss");
    },
    
    // Analyze which moves were most effective
    analyzeMoveEffectiveness: function(game, learningRate, isWin) {
        // Skip if no moves were made
        if (game.moves.length === 0) return;
        
        // Count successful vs unsuccessful moves
        let successfulCaptures = 0;
        let unsuccessfulCaptures = 0;
        let goodMoves = 0;
        let badMoves = 0;
        
        // Look at moves that happened before a loss or win
        for (let i = 0; i < game.moves.length; i++) {
            const move = game.moves[i];
            
            // Look at the next few moves to see outcomes
            const nextFewMoves = game.moves.slice(i + 1, i + 4);
            
            // Was this move followed by a piece loss soon?
            const followedByLoss = nextFewMoves.some(m => 
                m.capturedPiece && 
                m.capturedPiece.player === gameState.cpuPlayer && 
                m.capturedPiece.power >= 3); // Significant piece loss
                
            if (move.type === 'move' && move.capturedPiece) {
                // This was a capture move
                if (!followedByLoss) {
                    successfulCaptures++;
                } else {
                    unsuccessfulCaptures++;
                }
            } else if (move.type === 'move') {
                // Regular move
                if (!followedByLoss) {
                    goodMoves++;
                } else {
                    badMoves++;
                }
            }
        }
        
        // Adjust weights based on move outcomes
        if (isWin) {
            // If we won, slightly increase strategies that worked
            if (successfulCaptures > unsuccessfulCaptures) {
                // Being aggressive with captures worked
                this.weights.powerDeficitStrategy.aggressiveCapture += learningRate;
            } else {
                // Being conservative worked better
                this.weights.powerDeficitStrategy.aggressiveCapture -= learningRate;
            }
        } else {
            // If we lost, adjust more significantly
            if (unsuccessfulCaptures > successfulCaptures) {
                // Too aggressive with captures, reduce
                this.weights.powerDeficitStrategy.aggressiveCapture -= learningRate * 2;
            }
            
            if (badMoves > goodMoves) {
                // Need to be more careful with strategic moves
                this.weights.powerDeficitStrategy.strategicValue += learningRate;
            }
        }
        
        // Keep values within reasonable bounds
        this.weights.powerDeficitStrategy.aggressiveCapture = 
            this.clampValue(this.weights.powerDeficitStrategy.aggressiveCapture, 0.2, 0.9);
        this.weights.powerDeficitStrategy.strategicValue = 
            this.clampValue(this.weights.powerDeficitStrategy.strategicValue, 1.0, 3.0);
    },
    
    // Analyze which pieces were most valuable
    analyzePieceValueEffectiveness: function(game, learningRate, isWin) {
        // Track which pieces were lost and which were effective
        const piecesLost = {};
        const piecesEffective = {};
        
        // Initialize counts
        for (const pieceType in this.weights.pieceValues) {
            if (pieceType !== 'centerControl') {
                piecesLost[pieceType] = 0;
                piecesEffective[pieceType] = 0;
            }
        }
        
        // Analyze captures
        game.moves.forEach(move => {
            if (move.type === 'move' && move.capturedPiece) {
                if (move.capturedPiece.player === gameState.cpuPlayer) {
                    // We lost this piece
                    piecesLost[move.capturedPiece.type]++;
                } else {
                    // We captured an opponent piece
                    // Credit the piece type that made the capture
                    const fromPiece = move.fromPosition ? 
                        gameState.board[move.fromPosition.row][move.fromPosition.col] : null;
                    
                    if (fromPiece && fromPiece.type) {
                        piecesEffective[fromPiece.type]++;
                    }
                }
            }
        });
        
        // Adjust piece values based on their performance
        for (const pieceType in this.weights.pieceValues) {
            if (pieceType !== 'centerControl') {
                // If we lost a lot of this piece type, adjust its value
                if (piecesLost[pieceType] > 0) {
                    // This piece type was vulnerable - either protect better or value less
                    this.weights.pieceValues[pieceType] -= learningRate * piecesLost[pieceType];
                }
                
                // If this piece type was effective, increase its value
                if (piecesEffective[pieceType] > 0) {
                    this.weights.pieceValues[pieceType] += learningRate * piecesEffective[pieceType];
                }
                
                // Keep values within reasonable bounds
                this.weights.pieceValues[pieceType] = 
                    this.clampValue(this.weights.pieceValues[pieceType], 0.5, 2.0);
            }
        }
        
        // Special case for dragon and mouse relationship
        if (piecesLost.dragon > 0) {
            // Lost a dragon, increase mouse threat awareness
            this.weights.mouseThreat += learningRate * 2;
            this.weights.dragonProtection += learningRate * 2;
        }
        
        if (piecesEffective.mouse > 0) {
            // Mouse was effective (probably captured a dragon)
            this.weights.mouseThreat += learningRate * 3;
        }
    },
    
    // Analyze uncovering strategy effectiveness
    analyzeUncoverStrategy: function(game, learningRate, isWin) {
        // Skip if no pieces were uncovered
        if (game.uncovered.length === 0) return;
        
        let goodUncovers = 0;
        let badUncovers = 0;
        
        game.uncovered.forEach(uncover => {
            // Check if this uncovered piece was captured soon after
            const uncoverTime = uncover.timestamp;
            const capturedSoon = game.moves.some(move => 
                move.capturedPiece && 
                move.capturedPiece.player === gameState.cpuPlayer &&
                move.capturedPiece.type === uncover.piece.type &&
                move.timestamp - uncoverTime < 10000  // Captured within 10 seconds
            );
            
            if (capturedSoon) {
                badUncovers++;
            } else {
                goodUncovers++;
            }
        });
        
        // Adjust uncovering strategy based on outcomes
        if (isWin) {
            if (goodUncovers > badUncovers && game.uncovered.length > 3) {
                // Uncovering worked well, slightly increase
                this.weights.powerDeficitStrategy.uncover += learningRate;
                this.weights.powerAdvantageStrategy.uncover += learningRate / 2;
            }
        } else {
            if (badUncovers > goodUncovers) {
                // Uncovering went poorly, reduce
                this.weights.powerDeficitStrategy.uncover -= learningRate * 1.5;
                this.weights.powerAdvantageStrategy.uncover -= learningRate;
            }
        }
        
        // Keep values within reasonable bounds
        this.weights.powerDeficitStrategy.uncover = 
            this.clampValue(this.weights.powerDeficitStrategy.uncover, 0.3, 0.9);
        this.weights.powerAdvantageStrategy.uncover = 
            this.clampValue(this.weights.powerAdvantageStrategy.uncover, 0.1, 0.5);
    },
    
    // Helper to keep values within range
    clampValue: function(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },
    
    // Save learning state to localStorage
    saveLearningState: function() {
        try {
            const learningState = {
                weights: this.weights,
                lastUpdated: Date.now(),
                previousGames: this.gameHistory.previousGames.slice(0, 5) // Just save most recent games
            };
            
            localStorage.setItem('skillego_ai_learning', JSON.stringify(learningState));
        } catch (e) {
            console.error("Failed to save AI learning state:", e);
        }
    },
    
    // Load learning state from localStorage
    loadLearningState: function() {
        try {
            const savedState = localStorage.getItem('skillego_ai_learning');
            if (savedState) {
                const parsed = JSON.parse(savedState);
                
                // Update weights from saved state
                if (parsed.weights) {
                    // Deep merge the weights to handle new properties that might not exist in saved data
                    this.weights = this.deepMerge(this.weights, parsed.weights);
                }
                
                // Load previous games history if available
                if (parsed.previousGames && Array.isArray(parsed.previousGames)) {
                    this.gameHistory.previousGames = parsed.previousGames;
                }
                
                console.log("Loaded AI learning state from storage, last updated:", 
                    new Date(parsed.lastUpdated).toLocaleString());
                return true;
            }
        } catch (e) {
            console.error("Failed to load AI learning state:", e);
        }
        return false;
    },
    
    // Helper for deep merging objects
    deepMerge: function(target, source) {
        const result = {...target};
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                if (target[key]) {
                    result[key] = this.deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    },
    
    // Get a learning-adjusted value for a specific weight
    getWeight: function(category, weightName) {
        if (this.weights[category] && this.weights[category][weightName] !== undefined) {
            return this.weights[category][weightName];
        }
        
        // Default fallback values if the specific weight doesn't exist
        const defaults = {
            powerDeficitStrategy: {
                uncover: 0.7,
                aggressiveCapture: 0.6,
                strategicValue: 1.5
            },
            powerAdvantageStrategy: {
                uncover: 0.3,
                safeMovePriority: 0.8,
                aggressiveCapture: 0.2
            }
        };
        
        return defaults[category] && defaults[category][weightName] !== undefined ? 
            defaults[category][weightName] : 1.0;
    },
    
    // Reset learning to default values (for testing or if learning goes off track)
    resetLearning: function() {
        this.weights = {
            powerDeficitStrategy: {
                uncover: 0.7,
                aggressiveCapture: 0.6,
                strategicValue: 1.5
            },
            powerAdvantageStrategy: {
                uncover: 0.3,
                safeMovePriority: 0.8,
                aggressiveCapture: 0.2
            },
            pieceValues: {
                mouse: 1.0,
                cat: 1.0,
                wolf: 1.0,
                bear: 1.0,
                eagle: 1.0,
                dragon: 1.0,
                centerControl: 1.0
            },
            dragonProtection: 1.0,
            mouseThreat: 1.0
        };
        
        this.gameHistory = {
            currentGame: { moves: [], uncovered: [], outcome: null },
            previousGames: []
        };
        
        localStorage.removeItem('skillego_ai_learning');
        console.log("AI learning has been reset to default values");
    },
    
    // Return a confidence score showing how much we've learned (0-100)
    getLearningConfidence: function() {
        const gamesPlayed = this.gameHistory.previousGames.length;
        const weightDeviation = Object.values(this.weights.pieceValues)
            .filter(v => typeof v === 'number')
            .reduce((sum, val) => sum + Math.abs(val - 1.0), 0);
        
        // Score based on games played and how much weights have changed from default
        const gameScore = Math.min(gamesPlayed * 5, 50);  // Up to 50 points from games played
        const weightScore = Math.min(weightDeviation * 10, 50); // Up to 50 points from weight adjustments
        
        return Math.floor(gameScore + weightScore);
    },
    
    // Get learning stats for display
    getLearningSummary: function() {
        const gamesPlayed = this.gameHistory.previousGames.length;
        const wins = this.gameHistory.previousGames.filter(g => g.outcome === 'win').length;
        const confidence = this.getLearningConfidence();
        
        // Find most and least valued pieces based on learned weights
        let mostValued = {type: 'none', value: 0};
        let leastValued = {type: 'none', value: 999};
        
        for (const pieceType in this.weights.pieceValues) {
            if (pieceType !== 'centerControl') {
                const value = this.weights.pieceValues[pieceType];
                if (value > mostValued.value) {
                    mostValued = {type: pieceType, value};
                }
                if (value < leastValued.value) {
                    leastValued = {type: pieceType, value};
                }
            }
        }
        
        return {
            gamesPlayed,
            wins,
            winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
            confidence,
            mostValued,
            leastValued,
            aggressiveness: Math.round(this.weights.powerDeficitStrategy.aggressiveCapture * 100),
            uncoverTendency: Math.round(this.weights.powerDeficitStrategy.uncover * 100)
        };
    }
};
