// ==UserScript==
// @name         Chat
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      2.13
// @description  Cleanup clutter from twitch chat
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Chat.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Chat.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// ==/UserScript==

// TODO: Make chatbox not scrollable

(function() {
    'use strict';

    const testing = typeof module !== 'undefined' && module.exports;

    let fadeoutDuration = 18 * 1000;
    let maxVisibleMessages = 10;
    let brightness = 1;
    let currentUser = getCookie('name');
    let observer;
    let tildeHeld = false;

    document.addEventListener('keydown', function(event) {
        // const editor = document.querySelector('.chat-wysiwyg-input__editor');
        if (event.key === '~') {
            event.preventDefault();
            if (!tildeHeld) {
                tildeHeld = true;
                const messages = document.querySelectorAll('.chat-line__message, .chat-line__status');
                messages.forEach(message => {
                    message.style.display = 'block';
                    message.style.opacity = brightness;
                });
            }
            // } else if (event.key === '`') {
            //     // Makes it too easy to type stupid shit
            //     event.preventDefault();
            //     editor?.focus();
            // } else if (event.key === 'Enter' && !event.shiftKey) {
            //     editor?.blur();
            // } else if (event.key === 'Escape' && document.activeElement === editor) {
            //     event.preventDefault();
            //     editor.blur();
        } else if (event.key === '_' && brightness > 0.2) {
            brightness = parseFloat((brightness - 0.1).toFixed(1));
            requestAnimationFrame(() => {
                messageBrightness();
                chatWindowOpacity();
            });
        } else if (event.key === '+' && brightness < 1) {
            brightness = parseFloat((brightness + 0.1).toFixed(1));
            requestAnimationFrame(() => {
                messageBrightness();
                chatWindowOpacity();
            });
        }
    });

    document.addEventListener('keyup', function(event) {
        if (event.key === '~') {
            tildeHeld = false;
            const container = observer?.targetElement;
            if (container) {
                fadeOverflowMessages(container);
            }
            // Re-process all messages with normal filtering
            observer?.disconnect();
            observer = null;
        }
    });

    function messageBrightness() {
        getVisibleMessages().forEach(message => {
            message.style.opacity = brightness;
        });
    }

    function chatWindowOpacity() {
        let rightColumn = document.querySelector('.channel-root__right-column');
        if (!rightColumn) return;

        rightColumn.style.transition = 'all 0.25s ease-in-out';
        let hasMessages = getVisibleMessages().length > 0;

        if (hasMessages) {
            rightColumn.style.opacity = '1';
            rightColumn.style.background = `linear-gradient(90deg, rgba(0,0,0,${brightness/2}) 0%, rgba(0,0,0,0.001) 100%)`;
        } else {
            rightColumn.style.opacity = '0';
            rightColumn.style.background = 'none';
        }
    }

    function getCookie(key) {
        let value = `; ${document.cookie}`;
        let parts = value.split(`; ${key}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    // TODO: Properly distinguish theater mode
    async function applyChatInputStyles(chatInputContainer) {
        let setOpacity = (opacityValue) => {
            chatInputContainer.style.opacity = opacityValue;
        };

        let show = () => setOpacity('1');
        let hide = () => setOpacity('0.15');

        hide();
        // Set opacity before transition so it doesnt flash
        await new Promise(resolve => setTimeout(resolve, 0));
        chatInputContainer.style.transition = 'opacity .25s';

        // Add event listeners for focus and hover to adjust opacity
        chatInputContainer.addEventListener('focusin', show);
        chatInputContainer.addEventListener('focusout', hide);
    }

    async function fadeOverflowMessages(chatContainer) {
        if (tildeHeld || !chatContainer) return;
        await new Promise(resolve => setTimeout(resolve, 0));

        // console.log('Running fadeOverflowMessages');

        let visibleMessages = getVisibleMessages(chatContainer);
        let numMessagesToFade = Math.max(0, visibleMessages.length - maxVisibleMessages);

        setTimeout(() => { // Needs to run slightly after fadeInScheduleFadeOut so the opacity doesnt get overridden
            for (let i = 0; i < numMessagesToFade; i++) {
                let oldestMessage = visibleMessages[i];
                oldestMessage.style.transition = 'opacity .5s ease-in-out';
                oldestMessage.style.opacity = '0';
            }
            setTimeout(chatWindowOpacity, 600);
        }, 10);
    }

    function getVisibleMessages(container = observer?.targetElement) {
        if (!container) return [];
        let chatMessages = container.querySelectorAll('.chat-line__message, .chat-line__status');
        return Array.from(chatMessages).filter(message => message.style.opacity !== '0' && message.style.display !== 'none');
    }
    function fadeInScheduleFadeOut(message) {
        // Fade in
        message.style.opacity = '0';
        setTimeout(() => {
            message.style.transition = 'opacity .5s ease-in-out, background .5s ease-in-out';
            // message.style.transition = 'opacity .5s ease-in-out';
            message.style.opacity = brightness;
            message.style.setProperty('padding', '.5rem 1.3rem', 'important');
            chatWindowOpacity();
        }, 0);

        // Schedule fade out
        setTimeout(() => {
            message.style.transition = 'opacity 1s ease-in-out';
            message.style.opacity = '0';
            setTimeout(chatWindowOpacity, 1000);
        }, fadeoutDuration);
    }

    // Remove ugly global badges & identify streamers
    async function hideBadgesAndColorNames(message) {
        // Some badges don't load immediately
        await new Promise(resolve => setTimeout(resolve, 0));

        let usernameElement = message.querySelector('.chat-author__display-name');
        let badges = message.querySelectorAll('.chat-badge');
        for (let element of badges) {
            let altAttr = element.getAttribute('alt');
            if (!altAttr.match(/Subscriber|Founder|Verified|Broadcaster|VIP|Moderator|Bot|Staff/)) {
                element.remove();
                continue;
            }

            // Highlight Mod/VIP/Broadcaster names so ugly badges can be hidden
            if (altAttr.match(/Broadcaster|VIP|Moderator/)) {
                element.style.setProperty('display', 'none', 'important');
                usernameElement.style.setProperty('color', 'white', 'important');

                if (altAttr.match(/Broadcaster/)) {
                    usernameElement.style.setProperty('background-color', '#ff0000', 'important');
                } else if (altAttr.match(/VIP/)) {
                    usernameElement.style.setProperty('background-color', '#b3008f', 'important');
                } else if (altAttr.match(/Moderator/)) {
                    usernameElement.style.setProperty('background-color', '#008800', 'important');
                }
            }
        }
    }

    function isSideConversation(message) {
        let streamer = window.location.pathname.substring(1);
        // Hide replies that aren't to/from the current user
        let isReply = message.getAttribute('aria-label')?.startsWith('Replying');
        if (isReply && !message.textContent.includes(currentUser)) {
            return true;
        }
        // Hide mentions that aren't to the current user || current streamer
        let mentionFragment = message.querySelector('.mention-fragment');
        if (mentionFragment &&
            mentionFragment.textContent.toLowerCase() != ('@' + streamer) &&
            !mentionFragment.classList.contains('mention-fragment--recipient') &&
            !mentionFragment.classList.contains('mention-fragment--sender')) {
            return true;
        }
        return;
    }

    function hasUnwantedEmote(message) {
        // Under construction
        return;
    }

    function hasCyrillic(str) {
        if (typeof str !== 'string') {
            throw new TypeError('Input must be a string');
        }

        // Regex pattern for Cyrillic characters using Unicode ranges
        const cyrillicPattern = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F\u1C80-\u1C8F]/;
        return cyrillicPattern.test(str);
    }

    async function hideDuplicateEmotes(message) {
        // Wait for BTTV to insert emotes
        await new Promise(resolve => setTimeout(resolve, 0));

        let emoteButtons = message.querySelectorAll('.chat-line__message--emote-button, .bttv-emote');
        let seenEmotes = {};

        // Hide subsequent duplicate emotes
        emoteButtons.forEach(emoteButton => {
            let emoteImg = emoteButton.querySelector('img');
            let altText = emoteImg.getAttribute('alt');
            if (seenEmotes[altText]) {
                emoteButton.style.display = 'none';
            } else {
                seenEmotes[altText] = true;
            }
        });
    }

    function clipCardAppearance(message) {
        const clipCard = message.querySelector('.chat-card');
        if (!clipCard) return;

        // Hide the raw clip URL text
        const link = message.querySelector('.link-fragment');
        if (link) {
            link.style.setProperty('display', 'none', 'important');
        }

        // Remove card container background two levels up
        let parentTwo = clipCard.parentElement?.parentElement;
        if (parentTwo) {
            parentTwo.style.setProperty('background', 'none', 'important');
        }

        // Remove border and shadow on the outer wrapper
        let parentThree = parentTwo?.parentElement;
        if (parentThree) {
            parentThree.style.setProperty('box-shadow', 'none', 'important');
            parentThree.style.setProperty('border-style', 'none', 'important');
        }
    }

    // Get the React internal instance from a DOM element
    function getReactInstance(element) {
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                return element[key];
            }
        }
        return null;
    }

    // Search React parent components up to a maximum depth
    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                return node;
            }
        } catch (_) {}

        if (!node || depth > maxDepth) {
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        return null;
    }

    // Get the React component that contains the `props`
    function getMessageProps(element) {
        try {
            const node = searchReactParents(
                getReactInstance(element),
                n => n.memoizedProps && n.memoizedProps.message != null,
                30
            );
            if (node) {
                return node.memoizedProps;
            } else {
                console.warn("React node with message props not found.");
            }
        } catch (e) {
            console.error("Failed to retrieve the message props:", e);
        }
        return null;
    }

    function newMessageHandler(message) {
        hideBadgesAndColorNames(message);
        fadeInScheduleFadeOut(message);

        if (tildeHeld) return;

        let streamer = window.location.pathname.substring(1);
        let usernameElement = message.querySelector('.chat-author__display-name');
        let username = usernameElement?.textContent;
        let bodyElement = message.querySelector('[data-a-target="chat-line-message-body"]');
        let text = bodyElement ? bodyElement.textContent : '';
        let linkElement = message.querySelector('.link-fragment');


        // Highlight first time chats
        const props = getMessageProps(message);
        if (props?.message?.isFirstMsg && message?.style) {
            message.style.fontStyle = 'italic';
            message.style.fontWeight = 'bold';
        }

        // Hide the red line in chat that just says "New" || Hide bits
        if (message.querySelector('.live-message-separator-line__hr') ||
            message.querySelector('.chat-line__message--cheer-amount')) {
            message.style.setProperty('display', 'none', 'important');
            return;
        }

        // hideBadgesAndColorNames(message);

        // Hide streamer chatbots
        if (username?.toLowerCase().includes(streamer?.toLowerCase()) && linkElement) {
            // console.log('Hid streamer bot message', linkElement);
            message.style.display = 'none';
            return;
        }

        if (username?.includes(currentUser || streamer) || text?.includes(currentUser)) return;

        if (isSideConversation(message) || hasUnwantedEmote(message)) {
            message.style.display = 'none';
            return;
        }

        if (hasCyrillic(text)) {
            // message.style.display = 'none';
            // console.log('Removing cyrillic:', text);
            return;
        }

        // Hide chat commands (Messages that start with '!')
        if (text?.startsWith('!')) {
            message.style.display = 'none';
            return;
        }

        // Place higher to make sure it runs so styles are consistent when tildeHeld
        // hideBadgesAndColorNames(message);
        hideDuplicateEmotes(message);
        clipCardAppearance(message); // Does nothing
    }

    function chatObserver(chatContainer) {
        let observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type !== 'childList' || mutation.addedNodes.length == 0) {
                    return;
                }
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;

                    let message;
                    if (node.matches('.chat-line__message, .chat-line__status')) {
                        message = node;
                    } else {
                        message = node.querySelector('.chat-line__message, .chat-line__status');
                    }
                    if (message) {
                        newMessageHandler(message);
                    }

                    fadeOverflowMessages(chatContainer);

                    // let chatInput = node.querySelector('.chat-input');
                    // if (chatInput) applyChatInputStyles(chatInput);

                    let chatHeader = node.querySelector('.stream-chat-header');
                    if (chatHeader) chatHeader.style.setProperty('display', 'none', 'important');
                });
            });
        });
        let config = { childList: true, subtree: true };
        observer.observe(chatContainer, config);
        return observer;
    }

    if (!testing) {
        setInterval(function() {
            let chatContainer = document.querySelector('.chat-shell')
            if (chatContainer && observer?.targetElement != chatContainer) {
                chatShellFound(chatContainer);
                // fadeOverflowMessages(chatContainer);
            }
        }, 100);
    }

    function chatShellFound(chatContainer) {
        // Set initial appearance for anything that already loaded
        chatWindowOpacity();
        chatContainer.querySelectorAll('.chat-line__message, .chat-line__status').forEach(message => newMessageHandler(message));

        fadeOverflowMessages(chatContainer);

        // Create long-term observer
        observer?.disconnect();
        observer = chatObserver(chatContainer);
        observer.targetElement = chatContainer;
        // Setup chat input box behavior and appearance
        // let chatInput = chatContainer.querySelector('.chat-input');
        // if (chatInput) applyChatInputStyles(chatInput);
    }

    if (testing && typeof module !== 'undefined') {
        module.exports = {
            isSideConversation,
            hasCyrillic,
            clipCardAppearance,
            newMessageHandler
        };
    }

})();
