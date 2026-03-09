const markers = Array.from(document.querySelectorAll("[data-step-marker]"));
const panels = Array.from(document.querySelectorAll("[data-step-panel]"));
const intakeForm = document.getElementById("snapshot-intake-form");
const verifyForm = document.getElementById("snapshot-verify-form");
const consentBox = document.getElementById("snapshot-consent");
const consentNext = document.getElementById("snapshot-consent-next");
const backButtons = Array.from(document.querySelectorAll("[data-snapshot-back]"));
const restartButton = document.querySelector("[data-snapshot-restart]");

const summaryName = document.getElementById("snapshot-summary-name");
const summaryBureau = document.getElementById("snapshot-summary-bureau");
const summaryDate = document.getElementById("snapshot-summary-date");
const scoreNumber = document.getElementById("snapshot-score-number");
const scoreRating = document.getElementById("snapshot-score-rating");
const bandMarker = document.getElementById("snapshot-band-marker");
const negativeCount = document.getElementById("snapshot-negative-count");
const sharedBureaus = document.getElementById("snapshot-shared-bureaus");

const state = {
  step: 1,
  firstName: "",
  lastName: "",
  bureau: "TransUnion",
  score: 561,
};

function setStep(step) {
  state.step = step;

  markers.forEach((marker) => {
    const markerStep = Number(marker.dataset.stepMarker);
    marker.classList.toggle("is-active", markerStep === step);
    marker.classList.toggle("is-complete", markerStep < step);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("is-active", Number(panel.dataset.stepPanel) === step);
  });
}

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function computeScore(ssnLast4) {
  const digits = String(ssnLast4).replace(/\D/g, "");
  const lastDigit = Number(digits.slice(-1) || 0);
  return 552 + lastDigit * 3;
}

function ratingForScore(score) {
  if (score < 580) {
    return { label: "Needs attention", position: "34%" };
  }
  if (score < 670) {
    return { label: "Fair", position: "48%" };
  }
  if (score < 740) {
    return { label: "Good", position: "63%" };
  }
  if (score < 800) {
    return { label: "Very good", position: "79%" };
  }
  return { label: "Excellent", position: "92%" };
}

function fillSummary() {
  const fullName = [state.firstName, state.lastName].filter(Boolean).join(" ").trim();
  const rating = ratingForScore(state.score);

  summaryName.textContent = fullName || "Sample Client";
  summaryBureau.textContent = state.bureau;
  summaryDate.textContent = formatToday();
  scoreNumber.textContent = String(state.score);
  scoreRating.textContent = rating.label;
  bandMarker.style.left = rating.position;
  negativeCount.textContent = state.score < 580 ? "9" : "6";
  sharedBureaus.textContent = state.bureau === "TransUnion" ? "2" : "3";
}

if (intakeForm) {
  intakeForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!intakeForm.reportValidity()) {
      return;
    }

    state.firstName = document.getElementById("snapshot-first-name").value.trim();
    state.lastName = document.getElementById("snapshot-last-name").value.trim();

    setStep(2);
  });
}

if (consentNext) {
  consentNext.addEventListener("click", () => {
    if (!consentBox.checked) {
      consentBox.focus();
      return;
    }

    setStep(3);
  });
}

if (verifyForm) {
  verifyForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!verifyForm.reportValidity()) {
      return;
    }

    const bureauInput = document.getElementById("snapshot-bureau");
    const ssnInput = document.getElementById("snapshot-ssn4");

    state.bureau = bureauInput.value;
    state.score = computeScore(ssnInput.value);

    fillSummary();
    setStep(4);
  });
}

backButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setStep(Number(button.dataset.snapshotBack));
  });
});

if (restartButton) {
  restartButton.addEventListener("click", () => {
    if (intakeForm) intakeForm.reset();
    if (verifyForm) verifyForm.reset();
    if (consentBox) consentBox.checked = false;
    state.firstName = "";
    state.lastName = "";
    state.bureau = "TransUnion";
    state.score = 561;
    fillSummary();
    setStep(1);
  });
}

fillSummary();
setStep(1);
