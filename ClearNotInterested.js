// ==UserScript==
// @name         Clear Twitch Not Interested
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.0
// @description  Bulk clear your "Not Interested" list - run clearNotInterested() in console
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/ClearNotInterested.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/ClearNotInterested.js
// @match        *://*.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let authorizationHeader = null;
    let deviceId = null;
    let clientVersion = null;
    let clientSession = null;
    let clientIntegrityHeader = null;

    // Hook fetch to capture auth headers
    const realFetch = window.fetch;
    window.fetch = function(url, init, ...args) {
        if (typeof url === 'string') {
            if (url.includes('/access_token') || url.includes('gql')) {
                if (init?.headers) {
                    if (url.includes('origin=twilight')) {
                        deviceId = init.headers['X-Device-Id'] || init.headers['Device-ID'] || deviceId;
                        clientVersion = init.headers['Client-Version'] || clientVersion;
                        clientSession = init.headers['Client-Session-Id'] || clientSession;
                        clientIntegrityHeader = init.headers['Client-Integrity'] || clientIntegrityHeader;
                        authorizationHeader = init.headers['Authorization'] || authorizationHeader;
                    }
                }
            }
        }
        return realFetch.apply(this, arguments);
    };

    function getGqlHeaders() {
        const headers = {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Content-Type': 'application/json'
        };
        if (deviceId) {
            headers['X-Device-Id'] = deviceId;
            headers['Device-ID'] = deviceId;
        }
        if (clientVersion) headers['Client-Version'] = clientVersion;
        if (clientSession) headers['Client-Session-Id'] = clientSession;
        if (clientIntegrityHeader) headers['Client-Integrity'] = clientIntegrityHeader;
        if (authorizationHeader) headers['Authorization'] = authorizationHeader;
        return headers;
    }

    async function fetchNotInterestedList() {
        const feedbackEntries = []; // { channelId, feedbackId, name, displayName }
        let cursor = null;
        const LIMIT = 100;

        do {
            const query = {
                query: `query GetNotInterestedChannels {
                    currentUser {
                        recommendationFeedback(type: "CHANNEL", limit: ${LIMIT}${cursor ? `, after: "${cursor}"` : ''}) {
                            edges {
                                node {
                                    id
                                    content {
                                        ... on Channel {
                                            id
                                            name
                                            displayName
                                        }
                                    }
                                }
                                cursor
                            }
                            pageInfo {
                                hasNextPage
                            }
                        }
                    }
                }`
            };

            const response = await fetch('https://gql.twitch.tv/gql', {
                method: 'POST',
                headers: getGqlHeaders(),
                body: JSON.stringify(query)
            });

            const data = await response.json();
            const feedback = data.data?.currentUser?.recommendationFeedback;

            if (!feedback?.edges) break;

            for (const edge of feedback.edges) {
                const node = edge.node;
                const channelId = node?.content?.id;
                if (channelId) {
                    feedbackEntries.push({
                        channelId,
                        feedbackId: node.id,
                        name: node.content.name,
                        displayName: node.content.displayName
                    });
                }
                cursor = edge.cursor;
            }

            if (!feedback.pageInfo?.hasNextPage) break;
        } while (cursor);

        return feedbackEntries;
    }

    window.clearNotInterested = async () => {
        if (!authorizationHeader) {
            console.error('Auth headers not captured yet. Navigate around Twitch a bit and try again.');
            return;
        }

        console.log('Fetching not interested list...');
        const entries = await fetchNotInterestedList();
        console.log(`Found ${entries.length} channels to remove.`);

        if (entries.length === 0) {
            console.log('Nothing to remove!');
            return { success: 0, failed: 0 };
        }

        console.table(entries.map(e => ({ name: e.name, displayName: e.displayName })));

        let success = 0, failed = 0;

        for (const entry of entries) {
            try {
                const body = [{
                    operationName: 'UndoRecommendationFeedback',
                    query: `mutation UndoRecommendationFeedback($input: UndoRecommendationFeedbackInput!) {
                        undoRecommendationFeedback(input: $input) { feedbackID }
                    }`,
                    variables: {
                        input: {
                            feedbackID: entry.feedbackId,
                            sourceItemPage: 'twitch_home',
                            sourceItemRequestID: 'JIRA-VXP-2397',
                            sourceItemTrackingID: ''
                        }
                    }
                }];

                const response = await fetch('https://gql.twitch.tv/gql#origin=twilight', {
                    method: 'POST',
                    headers: getGqlHeaders(),
                    body: JSON.stringify(body)
                });

                const data = await response.json();
                if (data[0]?.data?.undoRecommendationFeedback?.feedbackID) {
                    success++;
                } else {
                    failed++;
                }
            } catch (e) {
                failed++;
            }

            if ((success + failed) % 50 === 0) {
                console.log(`Progress: ${success + failed}/${entries.length} (${success} success, ${failed} failed)`);
            }

            await new Promise(r => setTimeout(r, 50));
        }

        console.log(`Done! Removed ${success} channels, ${failed} failed.`);
        return { success, failed };
    };

    console.log('[ClearNotInterested] Loaded. Run clearNotInterested() in console to clear your not interested list.');
})();
