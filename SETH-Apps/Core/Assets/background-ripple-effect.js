/**
 * Background Ripple Effect
 * Based on Aceternity UI Background Ripple Effect Component
 * Converted from React to vanilla JavaScript
 * Optimized for performance
 */

(function() {
    'use strict';
    
    // Performance: Limit max cells to prevent performance issues
    const MAX_CELLS = 800; // Reasonable limit for smooth performance
    const OPTIMAL_CELL_SIZE = 64; // Slightly larger cells = fewer cells = better performance
    
    // Throttle helper
    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    // Debounce helper
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    function createRippleEffect() {
        const container = document.querySelector('.ripple-background');
        if (!container) {
            // Try again after a short delay
            setTimeout(createRippleEffect, 100);
            return;
        }
        
        // Calculate grid size based on viewport - optimized
        const containerRect = container.getBoundingClientRect();
        const viewportWidth = Math.max(containerRect.width || window.innerWidth, window.innerWidth);
        const viewportHeight = Math.max(containerRect.height || window.innerHeight, window.innerHeight);
        
        // Calculate optimal cell size based on viewport to stay under MAX_CELLS
        let cellSize = OPTIMAL_CELL_SIZE;
        let cols = Math.ceil(viewportWidth / cellSize) + 2; // Reduced overflow
        let rows = Math.ceil(viewportHeight / cellSize) + 2;
        let totalCells = cols * rows;
        
        // If too many cells, increase cell size
        if (totalCells > MAX_CELLS) {
            const scaleFactor = Math.sqrt(totalCells / MAX_CELLS);
            cellSize = Math.ceil(cellSize * scaleFactor);
            cols = Math.ceil(viewportWidth / cellSize) + 2;
            rows = Math.ceil(viewportHeight / cellSize) + 2;
            totalCells = cols * rows;
        }
        
        // State
        let clickedCell = null;
        let animationFrameId = null;
        let isAnimating = false;
        let animationTimeout = null;
        
        // Create main container
        const mainContainer = document.createElement('div');
        mainContainer.className = 'ripple-main-container';
        
        // Light mode - header (#f6f7f8) ile aynı ton
        const lightBorderColor = 'rgba(226, 232, 240, 0.4)';
        const lightFillColor = 'rgba(246, 247, 248, 0.97)';
        const lightShadowColor = 'rgba(246, 247, 248, 0.5)';
        
        // Dark mode - header (#101922) ile aynı ton
        const darkBorderColor = 'rgba(30, 41, 59, 0.35)';
        const darkFillColor = 'rgba(16, 25, 34, 0.97)';
        const darkShadowColor = 'rgba(16, 25, 34, 0.5)';
        
        mainContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            height: 100%;
            width: 100%;
            z-index: 0;
            contain: layout style paint;
        `;
        
        // Initialize cells array early
        const cells = [];
        
        // Set initial CSS variables
        const isDark = document.documentElement.classList.contains('dark');
        if (isDark) {
            mainContainer.style.setProperty('--cell-border-color', darkBorderColor);
            mainContainer.style.setProperty('--cell-fill-color', darkFillColor);
            mainContainer.style.setProperty('--cell-shadow-color', darkShadowColor);
        } else {
            mainContainer.style.setProperty('--cell-border-color', lightBorderColor);
            mainContainer.style.setProperty('--cell-fill-color', lightFillColor);
            mainContainer.style.setProperty('--cell-shadow-color', lightShadowColor);
        }
        
        // Tema değişiminde hem CSS değişkenleri hem her hücrenin inline stilleri güncellenir
        function updateColors() {
            if (!cells || cells.length === 0) return;
            
            const isDark = document.documentElement.classList.contains('dark');
            const borderColor = isDark ? darkBorderColor : lightBorderColor;
            const fillColor = isDark ? darkFillColor : lightFillColor;
            
            mainContainer.style.setProperty('--cell-border-color', borderColor);
            mainContainer.style.setProperty('--cell-fill-color', fillColor);
            mainContainer.style.setProperty('--cell-shadow-color', isDark ? darkShadowColor : lightShadowColor);
            
            cells.forEach(cell => {
                cell.style.border = '0.5px solid ' + borderColor;
                cell.style.backgroundColor = fillColor;
                cell.style.opacity = '1';
                if (isDark) {
                    cell.style.boxShadow = '0px 0px 40px 1px var(--cell-shadow-color) inset';
                } else {
                    cell.style.boxShadow = '';
                }
            });
        }
        
        // Inner container - full viewport coverage
        const innerContainer = document.createElement('div');
        innerContainer.className = 'ripple-inner-container';
        innerContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            height: 100vh;
            width: 100vw;
            overflow: visible;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 0;
            margin: 0;
        `;
        
        // Pointer events overlay
        const overlay = document.createElement('div');
        overlay.className = 'ripple-overlay';
        overlay.style.cssText = `
            pointer-events: none;
            position: absolute;
            inset: 0;
            z-index: 2;
            height: 100%;
            width: 100%;
            overflow: hidden;
        `;
        
        innerContainer.appendChild(overlay);
        
        // Create grid container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'ripple-grid';
        const gridWidth = cols * cellSize;
        const gridHeight = rows * cellSize;
        gridContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1;
            display: grid;
            grid-template-columns: repeat(${cols}, ${cellSize}px);
            grid-template-rows: repeat(${rows}, ${cellSize}px);
            width: ${gridWidth}px;
            height: ${gridHeight}px;
            min-height: ${gridHeight}px;
            margin: 0;
            padding: 0;
            background: transparent;
            contain: layout style paint;
            will-change: contents;
        `;
        
        // Reset animation state function
        function resetAnimationState(keepClickedCell = false) {
            // Clear any pending timeouts
            if (animationTimeout) {
                clearTimeout(animationTimeout);
                animationTimeout = null;
            }
            
            if (!keepClickedCell) {
                clickedCell = null;
            }
            isAnimating = false;
            
            // Immediately reset all cells - güncel tema ile
            const isDarkMode = document.documentElement.classList.contains('dark');
            const baseFillColor = isDarkMode ? darkFillColor : lightFillColor;
            
            cells.forEach(c => {
                c.classList.remove('animate-cell-ripple');
                c.style.removeProperty('--delay');
                c.style.removeProperty('--duration');
                c.style.willChange = '';
                
                // Reset to base state - check if cell is hovered
                if (hoveredCells.has(c)) {
                    const hoverOpacity = isDarkMode ? 0.8 : 0.85;
                    c.style.opacity = hoverOpacity.toString();
                    c.style.backgroundColor = baseFillColor;
                } else {
                    c.style.opacity = '1';
                    c.style.backgroundColor = baseFillColor;
                }
            });
        }
        
        // Optimized updateGrid function using requestAnimationFrame
        function updateGrid() {
            if (!clickedCell) {
                resetAnimationState();
                return;
            }
            
            // Cancel any pending animation frame
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            
            // Reset previous animations but keep clickedCell
            resetAnimationState(true);
            
            // Set animating flag
            isAnimating = true;
            
            animationFrameId = requestAnimationFrame(() => {
                // Batch DOM updates
                const updates = [];
                
                cells.forEach((cell, idx) => {
                    const rowIdx = Math.floor(idx / cols);
                    const colIdx = idx % cols;
                    
                    // Calculate distance from clicked cell
                    const distance = Math.hypot(clickedCell.row - rowIdx, clickedCell.col - colIdx);
                    const delay = Math.max(0, distance * 55);
                    const duration = 200 + distance * 80;
                    
                    updates.push({
                        cell: cell,
                        delay: delay,
                        duration: duration
                    });
                });
                
                // Apply updates in batch
                updates.forEach(({ cell, delay, duration }) => {
                    cell.style.setProperty('--delay', `${delay}ms`);
                    cell.style.setProperty('--duration', `${duration}ms`);
                    cell.style.willChange = 'opacity, background-color';
                });
                
                // Trigger animations in next frame
                requestAnimationFrame(() => {
                    updates.forEach(({ cell }) => {
                        cell.classList.add('animate-cell-ripple');
                    });
                    
                    // Calculate animation end time and reset state
                    const maxDistance = Math.max(rows, cols);
                    const maxDuration = 200 + maxDistance * 80;
                    const maxDelay = maxDistance * 55;
                    
                    // Store timeout reference
                    animationTimeout = setTimeout(() => {
                        resetAnimationState();
                        animationTimeout = null;
                    }, maxDuration + maxDelay + 50);
                });
            });
        }
        
        // Use DocumentFragment for batch DOM insertion (performance optimization)
        const fragment = document.createDocumentFragment();
        
        // Track hovered cells to prevent stuck states
        const hoveredCells = new Set();
        
        // Hover handlers - her çalıştığında güncel tema okunur (tema değişiminde uyum)
        const handleMouseEnter = function(cell) {
            if (!clickedCell && !isAnimating) {
                const isDark = document.documentElement.classList.contains('dark');
                hoveredCells.add(cell);
                const hoverOpacity = isDark ? 0.8 : 0.85;
                cell.style.opacity = hoverOpacity.toString();
                cell.style.backgroundColor = isDark ? darkFillColor : lightFillColor;
            }
        };
        
        const handleMouseLeave = function(cell) {
            if (!clickedCell && !isAnimating) {
                const isDark = document.documentElement.classList.contains('dark');
                hoveredCells.delete(cell);
                const baseFillColor = isDark ? darkFillColor : lightFillColor;
                cell.style.opacity = '1';
                cell.style.backgroundColor = baseFillColor;
            }
        };
        
        for (let idx = 0; idx < totalCells; idx++) {
            const rowIdx = Math.floor(idx / cols);
            const colIdx = idx % cols;
            
            const cell = document.createElement('div');
            cell.className = 'ripple-cell';
            cell.dataset.row = rowIdx;
            cell.dataset.col = colIdx;
            
            // Base styles - Optimized
            const isDark = document.documentElement.classList.contains('dark');
            const borderColor = isDark ? darkBorderColor : lightBorderColor;
            const fillColor = isDark ? darkFillColor : lightFillColor;
            
            // Set opacity based on theme
            const baseOpacity = isDark ? 0.5 : 0.6;
            
            cell.style.cssText = `
                position: relative;
                border: 0.5px solid ${borderColor};
                background-color: ${fillColor};
                opacity: ${baseOpacity};
                transition: opacity 0.2s ease, background-color 0.2s ease;
                cursor: pointer;
                pointer-events: auto;
                -webkit-tap-highlight-color: transparent;
                min-width: ${cellSize}px;
                min-height: ${cellSize}px;
                box-sizing: border-box;
                contain: layout style paint;
            `;
            
            // Only add will-change during animation
            // Initial shadow setup
            if (isDark) {
                cell.style.boxShadow = '0px 0px 40px 1px var(--cell-shadow-color) inset';
            }
            
            // Hover handlers - immediate response, no throttling for reliability
            cell.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                handleMouseEnter(cell);
            }, { passive: true });
            
            cell.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
                handleMouseLeave(cell);
            }, { passive: true });
            
            // Also handle mouseout as fallback
            cell.addEventListener('mouseout', (e) => {
                if (!cell.matches(':hover')) {
                    handleMouseLeave(cell);
                }
            }, { passive: true });
            
            // Click handler - optimized
            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                // Cancel any pending animation frame
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                
                // Clear any pending timeout
                if (animationTimeout) {
                    clearTimeout(animationTimeout);
                    animationTimeout = null;
                }
                
                // Clear all hover states before reset
                hoveredCells.clear();
                
                // Immediately reset all cells to base state
                resetAnimationState();
                
                // Set new clicked cell and trigger animation in next frame
                requestAnimationFrame(() => {
                    clickedCell = { row: rowIdx, col: colIdx };
                    updateGrid();
                });
            }, { passive: false });
            
            // Touch support for mobile
            cell.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                cell.click();
            }, { passive: true });
            
            fragment.appendChild(cell);
            cells.push(cell);
        }
        
        // Batch append all cells at once
        gridContainer.appendChild(fragment);
        
        innerContainer.appendChild(gridContainer);
        
        // Now update colors with cells array populated
        updateColors();
        
        // Watch for dark mode changes - debounced
        const debouncedUpdateColors = debounce(updateColors, 100);
        const observer = new MutationObserver(() => {
            debouncedUpdateColors();
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
        
        // Handle window resize - debounced and optimized
        const handleResize = debounce(() => {
            // Only recreate if size changed significantly
            const newWidth = window.innerWidth;
            const newHeight = window.innerHeight;
            const widthDiff = Math.abs(newWidth - viewportWidth);
            const heightDiff = Math.abs(newHeight - viewportHeight);
            
            // Only recreate if change is significant (>100px)
            if (widthDiff > 100 || heightDiff > 100) {
                const oldContainer = container.querySelector('.ripple-main-container');
                if (oldContainer) {
                    oldContainer.remove();
                }
                createRippleEffect();
            }
        }, 300);
        
        window.addEventListener('resize', handleResize, { passive: true });
        
        mainContainer.appendChild(innerContainer);
        container.appendChild(mainContainer);
    }
    
    // Initialize when DOM is ready - optimized
    // Wrap in try-catch to prevent errors from breaking the page
    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(createRippleEffect, 200);
            });
        } else {
            // Use requestIdleCallback if available for better performance
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => {
                    setTimeout(createRippleEffect, 200);
                }, { timeout: 500 });
            } else {
                setTimeout(createRippleEffect, 200);
            }
        }
    } catch (error) {
        console.error('Error initializing ripple effect:', error);
        // Don't break the page if ripple effect fails
    }
})();
