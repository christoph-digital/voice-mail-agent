// ============================================================
// CH Voice Mail Agent
// ============================================================

// --- Config ---
const OPENAI_API_URL = 'https://api.openai.com/v1';
const N8N_WEBHOOK_BASE = 'https://possehl.app.n8n.cloud/webhook';
const WEBHOOK_URLS = {
  getInboxSummary: `${N8N_WEBHOOK_BASE}/voice-inbox-agent`,
  getEmailDetail: `${N8N_WEBHOOK_BASE}/voice-email-detail`,
  createDraftReply: `${N8N_WEBHOOK_BASE}/voice-email-reply`,
};
const TTS_VOICE = 'nova';
const TTS_MODEL = 'tts-1';
const CHAT_MODEL = 'gpt-4o-mini';

// --- System Prompt ---
const SYSTEM_PROMPT = `Du bist Christophs persoenlicher Mail-Assistent fuer unterwegs. Du wirst per Sprache genutzt (im Auto), deshalb antworte IMMER kurz und praegnant.

Wichtig:
- Alle Mails kommen bei Christoph als "gelesen" rein - kein Unterschied gelesen/ungelesen
- Mails werden automatisch in Ordner sortiert (Outlook-Regeln)
- Manche Mails sind Antworten auf Konversationen - gib den Kontext mit

Christophs Outlook-Ordner:
- "Posteingang" - Hauptordner, wichtigste Mails
- "_ Offen - Kurzfristig Antworten" - Mails die bald beantwortet werden muessen
- "_ Offen - Noch Warten" - Mails auf die Christoph auf Antwort wartet
- "_ Offen - De-Prio" - Automatisch sortierte, weniger wichtige Mails (Newsletter, Benachrichtigungen etc.)
- "_ Reminder" - Erinnerungen vom Follow-Up-System
- "Inbox Wait" - Mails die warten
- "_ Ablage" - Abgelegte Mails
- "_ Belege Offen" - Offene Belege
- "Bearbeitet" - Bereits bearbeitete Mails
- "Bearbeitet PipeDrive" - CRM-bearbeitete Mails
- "Makierungen" - Markierte Mails
- "Backlog" - Aufgaben-Backlog

Ordner-Matching (WICHTIG - der User spricht, erkenne den gemeinten Ordner):
- "De-Prio" / "deprio" / "unwichtige" / "Newsletter" → "_ Offen - De-Prio"
- "kurzfristig" / "dringend" / "bald antworten" / "offen" → "_ Offen - Kurzfristig Antworten"
- "warten" / "noch warten" / "ausstehend" → "_ Offen - Noch Warten"
- "Posteingang" / "Inbox" / "wichtige" → "Posteingang"
- "bearbeitet" / "erledigt" / "fertig" → "Bearbeitet"
- "Belege" / "Rechnungen" → "_ Belege Offen"
- "Backlog" / "spaeter" → "Backlog"
- "Reminder" / "Erinnerungen" → "_ Reminder"

Wenn der User nach einem bestimmten Ordner fragt (z.B. "Was liegt in De-Prio?", "Gibts was Kurzfristiges?"), filtere die Ergebnisse auf den passenden Ordner. Die Mails haben ein "ordner" Feld.

Deine 3 Funktionen:
1. getInboxSummary - Neue Mails abrufen. Bei "Was gibts Neues?", "Zeig mir meine Mails" etc. Sende hours (Standard 4). "heute" = 12, "letzte Stunde" = 1, "seit heute Morgen" = 8. Ergebnis enthaelt Mails aus ALLEN Ordnern mit Ordner-Zuordnung.
2. getEmailDetail - Mail im Detail vorlesen. Nutze die emailId aus der Zusammenfassung.
3. createDraftReply - Antwort-Entwurf in Outlook erstellen (wird NICHT gesendet!).

Antwort-Entwuerfe (createDraftReply) - WICHTIG:
Der User diktiert per Sprache im Auto. Zwei Modi:
a) WOERTLICH: "Antworte ihm: Passt, lass uns Montag telefonieren" / "Schreib zurueck: Danke, melde mich naechste Woche"
   → Nimm den diktierten Text 1:1, nur minimale Bereinigung (Satzzeichen, offensichtliche Sprachfehler). Nicht umformulieren!
b) SINNGEMÄSS: "Sag ihm dass es passt" / "Antwort: ich bin einverstanden, er soll Termin schicken"
   → Formuliere professionell in Christophs Stil: direkt, freundlich, Deutsch, Du-Form bei Kollegen/Bekannten, Sie bei Unbekannten.
Im Zweifel: Frag kurz nach ob woertlich oder formuliert.
Sage IMMER klar dass es ein Entwurf ist und NICHT gesendet wurde.

Regeln:
- IMMER Deutsch sprechen
- KURZ und praegnant - der User hoert zu im Auto und kann nicht mitlesen
- Bei Uebersicht: Erst Anzahl pro Ordner nennen, dann Details nur fuer relevante
- E-Mails in 1-2 Saetzen zusammenfassen, Absender + Betreff + Kernaussage
- Posteingang und Kurzfristig zuerst, De-Prio am Ende (oder weglassen wenn nicht gefragt)
- Merke dir emailIds waehrend der Konversation
- Bei Konversationen: Thread-Kontext erwaehnen
- Du bist NUR fuer Mails zustaendig, sonst nichts
- Wenn der User "die erste", "die von Thomas" etc. sagt, finde die richtige emailId
- Der User kann jederzeit unterbrechen (Barge-In) - reagiere natuerlich darauf`;

// --- Tool Definitions ---
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'getInboxSummary',
      description: 'Ruft neue E-Mails der letzten X Stunden aus Outlook ab',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Stunden zurueck, Standard 4' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getEmailDetail',
      description: 'Holt den vollstaendigen Inhalt einer E-Mail inkl. Konversationsverlauf',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'Die Email-ID aus getInboxSummary' }
        },
        required: ['emailId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createDraftReply',
      description: 'Erstellt einen Antwort-Entwurf in Outlook (wird NICHT gesendet)',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'Die Email-ID' },
          replyText: { type: 'string', description: 'Der Antworttext' }
        },
        required: ['emailId', 'replyText']
      }
    }
  }
];

// --- State ---
let state = 'IDLE';
let messages = [];
let recognition = null;
let currentAudio = null;
let currentTranscript = '';
let apiKey = '';
let abortController = null;
let srShouldRestart = false;
let speakResolve = null;      // Resolve function for speak() promise (barge-in)
let bargeInTimeout = null;    // Timer for delayed barge-in recognition start

// --- DOM Helpers ---
const $ = (id) => document.getElementById(id);

// ============================================================
// Init
// ============================================================
function init() {
  apiKey = localStorage.getItem('openai_api_key') || '';

  if (!apiKey) {
    showSettings();
  }

  $('mic-btn').addEventListener('click', toggleListening);
  $('settings-btn').addEventListener('click', showSettings);
  $('save-key-btn').addEventListener('click', saveApiKey);
  $('close-settings-btn').addEventListener('click', hideSettings);

  // Text input fallback
  $('send-btn').addEventListener('click', sendTextInput);
  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTextInput();
  });

  setupRecognition();
  setState('IDLE');
}

function sendTextInput() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  if (!apiKey) { showSettings(); return; }
  input.value = '';
  processUserInput(text);
}

// ============================================================
// Settings
// ============================================================
function showSettings() {
  $('settings-overlay').classList.add('visible');
  $('api-key-input').value = apiKey;
}

function hideSettings() {
  $('settings-overlay').classList.remove('visible');
}

function saveApiKey() {
  const key = $('api-key-input').value.trim();
  if (key) {
    apiKey = key;
    localStorage.setItem('openai_api_key', key);
    hideSettings();
  }
}

// ============================================================
// State Machine
// ============================================================
function setState(newState) {
  state = newState;
  const btn = $('mic-btn');
  btn.className = 'mic-btn ' + state.toLowerCase();

  switch (state) {
    case 'IDLE':
      $('status').textContent = 'Antippen zum Starten';
      break;
    case 'LISTENING':
      $('status').textContent = 'Hoere zu...';
      break;
    case 'PROCESSING':
      $('status').textContent = 'Denke nach...';
      break;
    case 'SPEAKING':
      $('status').textContent = 'Spricht... (reinreden zum Unterbrechen)';
      break;
  }
}

// ============================================================
// Speech Recognition (single-utterance mode, more stable)
// ============================================================
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('status').textContent = 'Speech Recognition nicht verfuegbar. Bitte Chrome oder Edge nutzen.';
    return;
  }

  recognition = new SR();
  recognition.lang = 'de-DE';
  recognition.continuous = false;  // Single utterance - more stable in Edge
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += t;
      } else {
        interim += t;
      }
    }

    if (finalText) {
      currentTranscript += finalText;
    }

    // Show live transcript
    $('transcript').textContent = currentTranscript + interim;

    // --- Barge-In: User spricht waehrend TTS laeuft → sofort unterbrechen ---
    if (state === 'SPEAKING' && (finalText || interim.length > 5)) {
      console.log('[Barge-in] User interrupted TTS');
      handleBargeIn();
    }
  };

  recognition.onerror = (event) => {
    console.log('[SR] Error:', event.error);
    if (event.error === 'not-allowed') {
      $('status').textContent = 'Mikrofon-Zugriff verweigert. Bitte in Browser-Einstellungen erlauben.';
      setState('IDLE');
      srShouldRestart = false;
    }
    // no-speech: user didn't say anything - just restart
    // aborted: we stopped it ourselves - don't restart
  };

  recognition.onend = () => {
    console.log('[SR] Ended, transcript:', currentTranscript, 'shouldRestart:', srShouldRestart);

    // If we got speech, process it
    if (currentTranscript.trim() && state === 'LISTENING') {
      processUserInput(currentTranscript.trim());
      return;
    }

    // If still in listening mode with no result, restart after a short delay
    if (srShouldRestart && state === 'LISTENING') {
      setTimeout(() => {
        if (state === 'LISTENING' && srShouldRestart) {
          try {
            recognition.start();
          } catch (e) {
            console.log('[SR] Restart failed:', e.message);
          }
        }
      }, 500); // 500ms delay prevents flicker
    }
  };
}

function startListening() {
  if (!apiKey) {
    showSettings();
    return;
  }
  if (!recognition) {
    $('status').textContent = 'Speech Recognition nicht verfuegbar';
    return;
  }

  currentTranscript = '';
  $('transcript').textContent = '';
  srShouldRestart = true;
  setState('LISTENING');

  try {
    recognition.start();
  } catch (e) {
    // May already be running
    recognition.abort();
    setTimeout(() => {
      try { recognition.start(); } catch (e2) { /* ignore */ }
    }, 300);
  }
}

function stopListening() {
  srShouldRestart = false;
  clearBargeIn();
  try {
    recognition.abort();
  } catch (e) { /* ignore */ }
}

// ============================================================
// Barge-In: User kann waehrend TTS reinreden
// ============================================================
function startBargeInListener() {
  if (!recognition) return;
  clearBargeIn();

  // 1.5s warten bevor Mic aktiv wird (sonst hoert er seine eigene TTS-Stimme)
  bargeInTimeout = setTimeout(() => {
    if (state !== 'SPEAKING') return;
    console.log('[Barge-in] Starting mic listener during TTS');
    currentTranscript = '';
    srShouldRestart = false; // Kein Auto-Restart in Barge-In Modus
    try {
      recognition.start();
    } catch (e) {
      console.log('[Barge-in] Mic start failed:', e.message);
    }
  }, 1500);
}

function clearBargeIn() {
  if (bargeInTimeout) {
    clearTimeout(bargeInTimeout);
    bargeInTimeout = null;
  }
}

function handleBargeIn() {
  // TTS sofort stoppen
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio = null;
  }
  clearBargeIn();

  // speak() Promise aufloesen damit processUserInput weiterlaeuft
  if (speakResolve) {
    speakResolve();
    speakResolve = null;
  }

  // In LISTENING wechseln - Recognition laeuft noch weiter und
  // wird in onend den vollstaendigen Satz verarbeiten
  setState('LISTENING');
  srShouldRestart = true;
}

function toggleListening() {
  switch (state) {
    case 'IDLE':
      startListening();
      break;
    case 'LISTENING':
      stopListening();
      if (currentTranscript.trim()) {
        processUserInput(currentTranscript.trim());
      } else {
        setState('IDLE');
      }
      break;
    case 'PROCESSING':
      // Cancel ongoing request
      if (abortController) abortController.abort();
      setState('IDLE');
      break;
    case 'SPEAKING':
      // Stop audio + barge-in, go to listening for next input
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.onended = null;
        currentAudio = null;
      }
      clearBargeIn();
      if (speakResolve) { speakResolve(); speakResolve = null; }
      // Barge-In Recognition stoppen bevor normales Listening startet
      try { recognition.abort(); } catch (e) { /* ignore */ }
      startListening();
      break;
  }
}

// ============================================================
// Process User Input
// ============================================================
async function processUserInput(text) {
  stopListening();
  setState('PROCESSING');
  $('transcript').textContent = text;

  try {
    const response = await sendToOpenAI(text);
    if (response && state === 'PROCESSING') {
      $('response-text').textContent = response;
      await speak(response);
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Error:', error);
    $('response-text').textContent = 'Fehler: ' + error.message;
    $('status').textContent = 'Fehler aufgetreten';
    setTimeout(() => setState('IDLE'), 3000);
  }
}

// ============================================================
// OpenAI Chat Completions + Function Calling
// ============================================================
async function sendToOpenAI(userMessage) {
  messages.push({ role: 'user', content: userMessage });
  abortController = new AbortController();

  // Function calling loop
  while (true) {
    const body = {
      model: CHAT_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      tools: TOOLS,
    };

    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Fehler ${response.status}`);
    }

    const data = await response.json();
    const msg = data.choices[0].message;

    // Add assistant message to history
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Execute each function call
      for (const toolCall of msg.tool_calls) {
        $('status').textContent = `Rufe ${toolCall.function.name} auf...`;
        const result = await executeWebhook(toolCall);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      // Loop back for final response
    } else {
      // Final text response
      abortController = null;
      return msg.content;
    }
  }
}

// ============================================================
// n8n Webhook Execution
// ============================================================
async function executeWebhook(toolCall) {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');
  const url = WEBHOOK_URLS[name];

  if (!url) {
    return { error: `Unbekannte Funktion: ${name}` };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: abortController?.signal,
    });

    if (!response.ok) {
      return { error: `Webhook Fehler: ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { error: `Webhook nicht erreichbar: ${error.message}` };
  }
}

// ============================================================
// OpenAI TTS
// ============================================================
async function speak(text) {
  setState('SPEAKING');

  try {
    const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS Fehler ${response.status}`);
    }

    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);

    currentAudio = new Audio(audioUrl);

    return new Promise((resolve) => {
      speakResolve = resolve; // Barge-In kann dieses Promise aufloesen

      currentAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        speakResolve = null;
        clearBargeIn();
        // Barge-In Recognition stoppen bevor normales Listening startet
        try { recognition.abort(); } catch (e) { /* ignore */ }
        // Auto-resume listening after TTS finishes
        startListening();
        resolve();
      };

      currentAudio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        speakResolve = null;
        clearBargeIn();
        setState('IDLE');
        resolve();
      };

      currentAudio.play().then(() => {
        // TTS laeuft → Barge-In Listener starten (Mic hoert mit)
        startBargeInListener();
      }).catch((err) => {
        console.error('Audio play error:', err);
        currentAudio = null;
        speakResolve = null;
        startListening();
        resolve();
      });
    });
  } catch (error) {
    console.error('TTS error:', error);
    speakResolve = null;
    setTimeout(() => startListening(), 500);
  }
}

// ============================================================
// Service Worker - Unregister old, register new
// ============================================================
if ('serviceWorker' in navigator) {
  // Clear old service workers first, then register fresh
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  }).then(() => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ============================================================
// Start
// ============================================================
document.addEventListener('DOMContentLoaded', init);
