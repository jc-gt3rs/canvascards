# Canvas Cards

I AM SICK OF ADS AND PAID WEBAPPS FOR FLASHCARDS.

Canvas Cards is a free, local flashcard app for studying questions and verified answers from Canvas quiz review pages. The web app and card data run on your computer.

## Requirements

- Node.js 18 or newer
- Google Chrome, for the importer extension
- A Canvas quiz page where the correct answer is already visible

## Start the local app

From the project folder:

```sh
npm start
```

Then open [http://localhost:8787](http://localhost:8787) in Chrome. Keep this terminal running while importing cards or studying.

Cards are stored in `data/cards.json`. Named sessions are stored as individual JSON files in `data/sessions/`. These files are local and can be backed up or copied with the project.

## Install the Chrome extension

1. Start the local app with `npm start`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the project’s `extension` folder.
6. Pin **Canvas Cards Importer** to the Chrome toolbar if desired.

After changing files in `extension`, return to `chrome://extensions` and click the extension’s reload button.

## Import cards from Canvas

1. Open a Canvas quiz review or Submission Details page.
2. Make sure the page has finished loading and all questions you want to import are rendered on the page.
3. Confirm that Canvas visibly marks the correct answer, selected correct response, or correct-answer text.
4. Click the Canvas Cards Importer toolbar button.
5. Check the extension badge/title for the extracted and imported counts.
6. Refresh the local app to study the new cards.

The importer only reads what is already visible in the active Canvas tab. It never submits quiz answers, unlocks a quiz, or tries to infer an answer that Canvas has not marked as correct. Duplicate question/answer pairs are ignored by the local server.

## Canvas formats supported so far

The importer currently targets classic Canvas quiz markup found in:

- **Submission Details** pages showing a graded attempt and visible correct answers.
- **Classic Canvas quiz review/results** pages where correct options have Canvas’s correct-answer classes, attributes, check icons, or selected-answer markers.
- Correct short-answer, numerical, matching, fill-in-the-blank, and essay responses when the correct response is visibly present in the question block and the question is marked correct.

The page must expose the questions in the DOM at the time the extension is clicked. The question count shown by the extension is the count it found in the rendered page. A warning badge (`!`) means the number of verified answer pairs did not match the number of detected question blocks; inspect the page, scroll or wait for all content to render, and import again.

## Not supported yet

- Locked quizzes, quiz-taking pages, or pages where Canvas does not reveal correct answers.
- Canvas pages that show only a score without the question-and-answer review blocks.
- Canvas New Quizzes / redesigned quiz interfaces whose markup is not covered by the current selectors.
- Questions loaded only after the importer runs, hidden behind tabs or collapsed sections, or inside inaccessible cross-origin frames.
- Unmarked answers that would require guessing, OCR, an external AI service, or bypassing Canvas permissions.

For unsupported pages, use a classic graded Submission Details/review page with the full question list rendered before clicking the extension.

## Study controls

- **All**, **Don’t know**, and **Know** filter the deck.
- Click a card or press **Space** to flip it vertically.
- **1** marks the current card as Don’t know; **2** marks it as Know.
- **Previous**, **Next**, and **Shuffle** change study order.
- **New** clears the working deck. **Save** creates or updates a named session. **Load** restores a saved session, warning first if the current deck has unsaved changes. **Rename** changes a saved session name.
- **Remove** deletes one card; **Remove all** clears the entire working deck after confirmation.
- **Dark mode** and **Dyslexic font** are saved in the browser. OpenDyslexic is bundled locally in `app/fonts`, so it does not depend on Comic Sans or an online font.

## Development

The server is a small Node HTTP server with no build step:

```sh
npm start
```

The UI is in `app/`, the importer is in `extension/`, and persistent data is in `data/`. After changing the app or server, restart `npm start` and refresh the browser page.
