// ==UserScript==
// @name         Auto Volume with LUFS Visualization
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.4
// @description  Analyze audio levels of a Twitch stream using LUFS measurement with visualization
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%20(LUFS).js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%20(LUFS).js
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG_MODE = true;
    function debug(...args) {
        if (DEBUG_MODE) {
            const now = new Date();
            const timestamp = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });
            console.log(`[Auto Volume Debug ${timestamp}]:`, ...args);
        }
    }

    let audioContext;
    let analyser;
    let source;
    let rafId;
    let newPageCooldownActive;
    let currentVolume = 1.0;

    const SAMPLE_RATE = 50;
    const BLOCK_SIZE = 4096;
    const LUFS_WINDOW = 1500;
    const PLOT_POINTS = 1500;

    let lastVolumeAdjustment = 0;
    const VOLUME_CHANGER_MODIFIER = 30;
    const VOLUME_DOWN_COOLDOWN = 500;
    const VOLUME_UP_COOLDOWN = 5000;
    const MAX_DB_THRESHOLD = -28;
    const MIN_DB_THRESHOLD = -50;
    const VOLUME_ADJUSTMENT = 0.005;
    const MAX_VOLUME = 1.0;
    const MIN_VOLUME = 0.01;

    const FIXED_TOP = MAX_DB_THRESHOLD + 5;

    const FILTER_COEFFICIENTS = {
        a: [1.0, -1.69065929318241, 0.73248077421585],
        b: [1.53512485958697, -2.69169618940638, 1.19839281085285]
    };

    let blockBuffer = new Float32Array(BLOCK_SIZE);
    let blockBufferIndex = 0;
    let lufsBuffer = Array(LUFS_WINDOW).fill((MIN_DB_THRESHOLD + MAX_DB_THRESHOLD)/2);
    let plotData = Array(PLOT_POINTS).fill((MIN_DB_THRESHOLD + MAX_DB_THRESHOLD)/2);
    let canvas;
    let ctx;

    function initAudio() {
        debug('Initializing audio context');
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            debug('Error: No video element found');
            return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = BLOCK_SIZE * 2;

        source = audioContext.createMediaElementSource(videoElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        debug('Audio context initialized', {
            sampleRate: audioContext.sampleRate,
            fftSize: analyser.fftSize
        });

        updateLevel();
    }

    function calculateLUFS(buffer) {
        let filtered = new Float32Array(buffer.length);
        for (let i = 2; i < buffer.length; i++) {
            filtered[i] = FILTER_COEFFICIENTS.b[0] * buffer[i] +
                FILTER_COEFFICIENTS.b[1] * buffer[i-1] +
                FILTER_COEFFICIENTS.b[2] * buffer[i-2] -
                FILTER_COEFFICIENTS.a[1] * filtered[i-1] -
                FILTER_COEFFICIENTS.a[2] * filtered[i-2];
        }

        const meanSquare = filtered.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length;
        const lufs = -0.691 + 10 * Math.log10(meanSquare);

        return lufs;
    }

    function getReactInstance(element) {
        debug('Searching for React instance');
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                debug('Found React instance key:', key);
                return element[key];
            }
        }
        debug('No React instance found');
        return null;
    }

    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                debug('Found matching React parent node at depth:', depth);
                return node;
            }
        } catch (e) {
            debug('Error in predicate:', e);
        }

        if (!node || depth > maxDepth) {
            depth > maxDepth && debug('Max depth reached in React parent search');
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        debug('No more parent nodes found');
        return null;
    }

    function getCurrentPlayer() {
        debug('Getting current player');
        const PLAYER_SELECTOR = 'div[data-a-target="player-overlay-click-handler"], .video-player';
        try {
            const node = searchReactParents(
                getReactInstance(document.querySelector(PLAYER_SELECTOR)),
                n => n.memoizedProps?.mediaPlayerInstance?.core != null,
                30
            );
            debug('Player node found:', !!node);
            return node?.memoizedProps.mediaPlayerInstance.core;
        } catch (e) {
            debug('Error getting player:', e);
        }
        return null;
    }

    function adjustVolume(volumeDelta) {
        const player = getCurrentPlayer();
        if (player) {
            const currentVol = player.getVolume();
            const newVolume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, currentVol + volumeDelta));
            debug('Adjusting volume', {
                currentVolume: parseFloat(currentVol.toFixed(2)),
                delta: volumeDelta,
                newVolume: parseFloat(newVolume.toFixed(2))
            });
            currentVolume = newVolume;
            player.setVolume(currentVolume);
        } else {
            debug('Warning: Player not found for volume adjustment');
        }
    }

    function updatePlot(shortTermLUFS, averageLUFS) {
        // Update data
        plotData.push(shortTermLUFS);
        plotData.shift();

        // Clear canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Find the lowest LUFS value in the buffer
        const minLUFS = MIN_DB_THRESHOLD - 5;

        // Convert LUFS value to Y coordinate using dynamic bottom and fixed top
        const toY = (lufs) => {
            const y = canvas.height - ((lufs - minLUFS) / (FIXED_TOP - minLUFS)) * canvas.height;
            return y;
        };

        // Draw grid lines and labels every 5 dB
        ctx.strokeStyle = '#333333';
        ctx.fillStyle = '#888888';
        ctx.font = '10px monospace';
        let gridStep = 5;
        let startLevel = Math.floor(minLUFS / gridStep) * gridStep;
        let endLevel = Math.ceil(FIXED_TOP / gridStep) * gridStep;

        for (let level = startLevel; level <= endLevel; level += gridStep) {
            let y = toY(level);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
            ctx.fillText(`${level} dB`, 5, y - 2);
        }

        // Draw max threshold line
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(0, toY(MAX_DB_THRESHOLD));
        ctx.lineTo(canvas.width, toY(MAX_DB_THRESHOLD));
        ctx.stroke();

        // Draw min threshold line
        ctx.strokeStyle = 'green';
        ctx.beginPath();
        ctx.moveTo(0, toY(MIN_DB_THRESHOLD));
        ctx.lineTo(canvas.width, toY(MIN_DB_THRESHOLD));
        ctx.stroke();

        // Draw LUFS history
        ctx.strokeStyle = 'cyan';
        ctx.beginPath();
        plotData.forEach((lufs, i) => {
            const x = (i / plotData.length) * canvas.width;
            const y = toY(lufs);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw legend
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 140, 70);

        ctx.font = '12px monospace';
        ctx.fillStyle = 'white';
        ctx.fillText(`Current: ${shortTermLUFS.toFixed(1)} dB`, 20, 30);
        ctx.fillText(`Average: ${averageLUFS.toFixed(1)} dB`, 20, 50);
        ctx.fillText(`Volume: ${(currentVolume * 100).toFixed(1)}%`, 20, 70);
    }

    function updateLevel() {
        const array = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(array);

        for (let i = 0; i < array.length; i++) {
            blockBuffer[blockBufferIndex] = array[i];
            blockBufferIndex++;

            if (blockBufferIndex >= BLOCK_SIZE && !newPageCooldownActive) {
                const lufs = calculateLUFS(blockBuffer);
                if (lufs && !isNaN(lufs) && lufs != -Infinity) {
                    lufsBuffer.push(lufs);
                }
                if (lufsBuffer.length > LUFS_WINDOW) {
                    lufsBuffer.shift();
                }
                const shortTermLUFS = lufsBuffer.slice(-10).reduce((sum, value) => sum + value, 0) / 10;
                const averageLUFS = lufsBuffer.reduce((sum, value) => sum + value, 0) / lufsBuffer.length;

                // debug('Audio metrics', {
                //     shortTermLUFS,
                //     averageLUFS,
                //     bufferSize: blockBufferIndex,
                //     timestamp: Date.now()
                // });

                if (DEBUG_MODE) {
                    updatePlot(shortTermLUFS, averageLUFS);
                }

                if (Date.now() - lastVolumeAdjustment > VOLUME_DOWN_COOLDOWN) {
                    if (shortTermLUFS > MAX_DB_THRESHOLD) {
                        let adjustment = Math.max(-0.1, (MAX_DB_THRESHOLD-shortTermLUFS)/VOLUME_CHANGER_MODIFIER);
                        adjustment = parseFloat(adjustment.toFixed(2));
                        if (adjustment) {
                            debug('Volume down adjustment', {
                                adjustment,
                                reason: 'Above max threshold'
                            });
                            adjustVolume(adjustment);
                            lastVolumeAdjustment = Date.now();
                        }
                    }
                }
                if (Date.now() - lastVolumeAdjustment > VOLUME_UP_COOLDOWN) {
                    if (Math.max(...lufsBuffer) < MAX_DB_THRESHOLD - 2) {
                        let adjustment = Math.min(0.05, ((MAX_DB_THRESHOLD) - Math.max(...lufsBuffer))/VOLUME_CHANGER_MODIFIER);
                        adjustment = parseFloat(adjustment.toFixed(2));
                        if (adjustment) {
                            debug('Volume up adjustment', {
                                adjustment,
                                reason: 'Below min threshold'
                            });
                            adjustVolume(adjustment);
                            lastVolumeAdjustment = Date.now();
                        }
                    }
                }

                blockBufferIndex = 0;
            }
        }

        rafId = requestAnimationFrame(updateLevel);
    }

    function handlePathChange() {
        debug('Page navigation detected');
        newPageCooldownActive = true;
        setTimeout(() => {
            debug('Navigation cooldown ended');
            adjustVolume(0);
            newPageCooldownActive = false;
        }, 2500);

        blockBufferIndex = 0;
        lufsBuffer = Array(LUFS_WINDOW).fill(MAX_DB_THRESHOLD);
    }

    function createVisualization() {
        debug('Creating visualization interface');
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.right = '10px';
        container.style.zIndex = '9999';
        container.style.padding = '10px';
        document.body.appendChild(container);

        canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 200;
        canvas.style.display = 'block';
        container.appendChild(canvas);

        ctx = canvas.getContext('2d');
        debug('Visualization created', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height
        });
    }

    function init() {
        debug('Initializing script');
        if (DEBUG_MODE) {
            createVisualization();
        }
        const observer = new MutationObserver((mutations) => {
            if (document.querySelector('video')) {
                debug('Video element found, initializing audio');
                observer.disconnect();
                initAudio();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    (function(history){
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                debug(`History method ${methodName} called`);
                const result = original.apply(this, arguments);
                setTimeout(handlePathChange, 0);
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);
    window.addEventListener('popstate', handlePathChange);

})();
