chrome.action.onClicked.addListener(async tab => {
  try {
    const executions = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: extractCards });
    const reports = executions.map(execution => execution.result).filter(Boolean);
    const cards = reports.flatMap(report => report.cards || []);
    const uniqueCards = [...new Map(cards.map(card => [`${card.front}\n${card.back}`, card])).values()];
    const questionCount = new Set(reports.flatMap(report => report.questions || [])).size;
    if (!uniqueCards.length) throw new Error('No verified question-and-answer pairs found. Open a Canvas Submission Details page where correct answers are visible.');
    const response = await fetch('http://localhost:8787/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: uniqueCards }) });
    if (!response.ok) throw new Error('Could not reach the local app. Start it with npm start.');
    const { imported } = await response.json();
    await chrome.action.setBadgeText({ tabId: tab.id, text: uniqueCards.length === questionCount ? String(imported) : '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#111111' });
    await chrome.action.setTitle({ tabId: tab.id, title: `Canvas Cards: extracted ${uniqueCards.length} of ${questionCount} questions; imported ${imported} new card${imported === 1 ? '' : 's'}` });
  } catch (error) {
    console.error('Canvas Cards:', error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#111111' });
    await chrome.action.setTitle({ tabId: tab.id, title: `Canvas Cards: ${error.message}` });
  }
});
function extractCards() {
  const clean = node => node?.innerText?.replace(/\s+/g, ' ').trim() || '';
  const answerText = option => {
    const label = option.querySelector('.answer_text, .answer-label, [data-testid="answer-text"], [class*="answerText"]');
    return clean(label || option)
      .replace(/^correct answer\s*/i, '')
      .replace(/^selected answer\s*/i, '')
      .trim();
  };
  const controlAnswers = holder => {
    const values = [];
    for (const input of holder.querySelectorAll('input:checked')) {
      const option = input.closest('.answer, [data-testid="answer"]');
      const value = option ? answerText(option) : input.value;
      if (value && value !== 'on') values.push(value);
    }
    for (const input of holder.querySelectorAll('input[type="text"], input:not([type])')) {
      if (input.value?.trim()) values.push(input.value.trim());
    }
    for (const area of holder.querySelectorAll('textarea')) {
      if (area.value?.trim()) values.push(area.value.trim());
    }
    for (const select of holder.querySelectorAll('select')) {
      for (const option of select.selectedOptions) {
        const value = option.textContent?.trim();
        if (value && !/^choose|select/i.test(value)) values.push(value);
      }
    }
    return values;
  };
  const candidateSelector = [
    '.quiz-submission .display_question',
    '.quiz-submission .question_holder',
    '.display_question',
    '.display_question[data-question-id]',
    '.question[data-question-id]',
    '.question_holder > .question',
    '[data-testid="question-container"]',
    '[data-testid="quiz-question"]'
  ].join(', ');
  const correctOptionSelector = [
    '.answers .answer.correct_answer',
    '.answers .answer.correct-answer',
    '.answers .answer.correct',
    '.answers .answer[data-correct="true"]',
    '.answers .answer[aria-label*="correct" i]',
    '[data-testid="answer"][data-correct="true"]',
    '[data-testid="answer"].correct-answer'
  ].join(', ');
  const pairs = [];
  const seenCards = new Set();
  const seenBlocks = new Set();
  const questions = [];

  for (const match of document.querySelectorAll(candidateSelector)) {
    const block = match.matches('.question_holder')
      ? match.querySelector('.display_question, .question') || match
      : match;
    if (seenBlocks.has(block)) continue;
    seenBlocks.add(block);
    const holder = block.closest('.question_holder') || block;
    const questionNode = block.querySelector('.question_text, .question_text_user, [data-testid="question-prompt"], .question-prompt, legend')
      || holder.querySelector('.question_text, .question_text_user, [data-testid="question-prompt"], .question-prompt, legend');
    const question = clean(questionNode);
    if (question) {
      const identity = block.id || block.getAttribute('data-question-id') || `${question}|${questions.length}`;
      questions.push(`${location.href}|${identity}`);
    }
    let correctOptions = [...holder.querySelectorAll(correctOptionSelector)];

    // Some classic Canvas themes mark the right option with a check icon
    // instead of a class on the answer itself.
    if (!correctOptions.length) {
      correctOptions = [...holder.querySelectorAll('.answers .answer')].filter(option =>
        option.querySelector('.icon-check, .icon-checkmark, .icon-check-mark, [data-testid="correct-answer-icon"]')
      );
    }

    const correctQuestionLabel = [...holder.querySelectorAll('.correct_answer')]
      .some(node => !node.closest('.answer') && /^correct answer$/i.test(clean(node)));
    const questionIsCorrect = block.matches('.correct, [data-correct="true"]')
      || holder.matches('.correct, [data-correct="true"]')
      || correctQuestionLabel;

    // On the Submission Details page, Canvas may only mark the whole
    // question as correct. Its selected option is then safe to import.
    if (!correctOptions.length && questionIsCorrect) {
      correctOptions = [...holder.querySelectorAll(
        '.answers .answer.selected_answer, .answers .answer.selected, .answers .answer[aria-checked="true"]'
      )];
      if (!correctOptions.length) {
        const checked = [...holder.querySelectorAll('.answers .answer input:checked, [data-testid="answer"] input:checked')];
        correctOptions = checked.map(input => input.closest('.answer, [data-testid="answer"]')).filter(Boolean);
      }
    }

    let answers = [...new Set(correctOptions.map(answerText).filter(Boolean))];

    // A correct short-answer, numerical, matching, or fill-in response is a
    // verified answer even when Canvas does not wrap it in `.answer`.
    if (!answers.length && questionIsCorrect) {
      answers = controlAnswers(holder);
      const responseNodes = holder.querySelectorAll(
        '.user_answer, .user-answer, .quiz_response_text, .selected_answer .answer_text, [data-testid="user-answer"]'
      );
      answers.push(...[...responseNodes].map(clean).filter(Boolean));
      const freeResponseType = block.matches('.short_answer_question, .numerical_question, .fill_in_multiple_blanks_question, .matching_question, .essay_question');
      if (!answers.length && freeResponseType) {
        answers.push(...[...holder.querySelectorAll('.answers .answer_text')].map(clean).filter(Boolean));
      }
      answers = [...new Set(answers)];
    }

    // Incorrect attempts sometimes show the actual answer in a dedicated,
    // narrowly scoped correct-answer text element.
    if (!answers.length) {
      const revealedCorrect = holder.querySelectorAll(
        '.correct_answer .answer_text, .correct-answer .answer_text, .correct_answer_text, [data-testid="correct-answer-text"]'
      );
      answers = [...new Set([...revealedCorrect].map(clean).filter(Boolean))];
    }
    const answer = answers.join('\n');
    const key = `${question}\n${answer}`;
    if (question && answer && question !== answer && !seenCards.has(key)) {
      seenCards.add(key);
      pairs.push({ front: question, back: answer, source: `Canvas · ${document.title}` });
    }
  }
  return { cards: pairs, questions };
}
