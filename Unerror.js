// ==UserScript==
// @name         Unerror
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.0
// @description  Automatically click reload button when Twitch player errors occur
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Unerror.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Unerror.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ERROR_DIALOG_COOLDOWN = false;
    let ERROR_DIALOG_COOLDOWN_DURATION = 5000; // 5 seconds cooldown between auto-reloads
    let POLLING_INTERVAL = 500; // Check every 500ms

    // Check for error dialogs and auto-click reload button
    function checkAndHandleErrorDialog() {
        if (ERROR_DIALOG_COOLDOWN) return;

        // Look for any error dialog
        const errorDialog = document.querySelector('[data-a-target="player-overlay-content-gate"]');
        if (!errorDialog) return;

        // Look for the reload button
        const reloadButton = errorDialog.querySelector('[data-a-target="tw-core-button-label-text"]');
        if (!reloadButton || !reloadButton.textContent.includes('Click Here to Reload Player')) return;

        // Get the error message for logging
        const errorText = errorDialog.querySelector('strong');
        const errorMessage = errorText ? errorText.textContent : 'Unknown error';

        // Click the button
        const buttonElement = reloadButton.closest('button');
        if (buttonElement) {
            console.log(`[Twitch Error Auto-Reload] Auto-clicking reload button for: ${errorMessage}`);
            buttonElement.click();

            // Set cooldown to prevent rapid clicking
            ERROR_DIALOG_COOLDOWN = true;
            setTimeout(() => {
                ERROR_DIALOG_COOLDOWN = false;
            }, ERROR_DIALOG_COOLDOWN_DURATION);
        }
    }

    // Start polling for error dialogs
    setInterval(checkAndHandleErrorDialog, POLLING_INTERVAL);

    console.log('[Twitch Error Auto-Reload] Script loaded and monitoring for player errors');
})();
