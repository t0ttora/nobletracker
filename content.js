// content.js - Google Workspace document auto-suggestion + lightweight activity hints
// Runs on all pages (permissions limited by manifest host permissions / activeTab). This
// script does NOT exfiltrate content; it only derives a stable document title for suggestion.

const SUGGEST_INTERVAL_MS = 120_000; // every 2 minutes
let lastSentDoc = null;

function isGoogleDocUrl(url) {
	return /https:\/\/(docs|sheets|slides)\.google\.com\//.test(url);
}

function extractDocTitle() {
	const title = document.title || '';
	// Remove trailing ' - Google Docs' etc.
	return title.replace(/ - Google (Docs|Sheets|Slides).*/,'').trim();
}

async function maybeSuggest() {
	try {
		if (!isGoogleDocUrl(location.href)) return;
		const docTitle = extractDocTitle();
		if (!docTitle || docTitle === lastSentDoc) return;
		lastSentDoc = docTitle;
		chrome.runtime.sendMessage({ type: 'DOC_SUGGEST', name: docTitle });
	} catch {/* ignore */}
}

setInterval(maybeSuggest, SUGGEST_INTERVAL_MS);
maybeSuggest();
