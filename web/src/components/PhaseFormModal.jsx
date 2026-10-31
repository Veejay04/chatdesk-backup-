import { useState } from "react";
import FieldError, { invalidInput } from "./FieldError.jsx";
import { LIMITS, hasErrors, maxLength, requiredText, serverErrors } from "../utils/validation.js";

function parseQuestions(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function validatePhase({ name, startDate, endDate, guidanceMessage, questions }) {
  let questionsError = null;
  if (questions.length > LIMITS.phaseQuestions) {
    questionsError = `Add at most ${LIMITS.phaseQuestions} suggested questions.`;
  } else if (questions.some((q) => q.length > LIMITS.phaseQuestion)) {
    questionsError = `Keep each question under ${LIMITS.phaseQuestion} characters.`;
  }
  return {
    name: requiredText(name, "Phase name") ?? maxLength(name, LIMITS.phaseName, "Phase name"),
    start_date: startDate ? null : "Start date is required.",
    end_date: !endDate
      ? "End date is required."
      : startDate && endDate < startDate
      ? "End date must be on or after the start date."
      : null,
    guidance_message: maxLength(guidanceMessage, LIMITS.phaseGuidance, "Guidance message"),
    suggested_questions: questionsError,
  };
}

export default function PhaseFormModal({ initialPhase, onSave, onClose }) {
  const [name, setName] = useState(initialPhase?.name ?? "");
  const [startDate, setStartDate] = useState(initialPhase?.start_date ?? "");
  const [endDate, setEndDate] = useState(initialPhase?.end_date ?? "");
  const [guidanceMessage, setGuidanceMessage] = useState(initialPhase?.guidance_message ?? "");
  const [suggestedQuestionsText, setSuggestedQuestionsText] = useState(
    (initialPhase?.suggested_questions ?? []).join("\n")
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    const questions = parseQuestions(suggestedQuestionsText);
    const found = validatePhase({ name, startDate, endDate, guidanceMessage, questions });
    setErrors(found);
    if (hasErrors(found)) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
        guidance_message: guidanceMessage.trim(),
        suggested_questions: questions,
      });
      onClose();
    } catch (error) {
      const { fields, general } = serverErrors(error, "Could not save this phase.");
      setErrors(fields);
      setErrorMessage(general ?? "");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg"
      >
        <h3 className="mb-4 text-lg font-bold text-navy">
          {initialPhase ? "Edit Phase" : "Add Phase"}
        </h3>

        <div className="mb-3">
          <label htmlFor="phase-name" className="mb-1 block text-sm text-gray-600">Name</label>
          <input
            id="phase-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Enrollment Period"
            aria-invalid={Boolean(errors.name)}
            className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/40 ${invalidInput(errors.name)}`}
          />
          <FieldError message={errors.name} />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="phase-start" className="mb-1 block text-sm text-gray-600">Start date</label>
            <input
              id="phase-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-invalid={Boolean(errors.start_date)}
              className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/40 ${invalidInput(errors.start_date)}`}
            />
            <FieldError message={errors.start_date} />
          </div>
          <div>
            <label htmlFor="phase-end" className="mb-1 block text-sm text-gray-600">End date</label>
            <input
              id="phase-end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={Boolean(errors.end_date)}
              className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/40 ${invalidInput(errors.end_date)}`}
            />
            <FieldError message={errors.end_date} />
          </div>
        </div>

        <div className="mb-3">
          <label htmlFor="phase-guidance" className="mb-1 block text-sm text-gray-600">Guidance message</label>
          <textarea
            id="phase-guidance"
            value={guidanceMessage}
            onChange={(e) => setGuidanceMessage(e.target.value)}
            rows={3}
            placeholder="Shown to students in the chat banner during this phase"
            aria-invalid={Boolean(errors.guidance_message)}
            className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/40 ${invalidInput(errors.guidance_message)}`}
          />
          <FieldError message={errors.guidance_message} />
        </div>

        <div className="mb-4">
          <label htmlFor="phase-questions" className="mb-1 block text-sm text-gray-600">
            Suggested questions (one per line, up to {LIMITS.phaseQuestions})
          </label>
          <textarea
            id="phase-questions"
            value={suggestedQuestionsText}
            onChange={(e) => setSuggestedQuestionsText(e.target.value)}
            rows={4}
            placeholder={"How do I apply for a scholarship?\nWhat are the enrollment requirements?"}
            aria-invalid={Boolean(errors.suggested_questions)}
            className={`w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold/40 ${invalidInput(errors.suggested_questions)}`}
          />
          <FieldError message={errors.suggested_questions} />
        </div>

        {errorMessage && <p className="mb-3 text-sm text-red-600">{errorMessage}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm text-gray-500 transition-colors hover:text-navy"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-full bg-navy px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
