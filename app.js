(() => {
  const form = document.getElementById("lead-form");
  const statusEl = document.getElementById("form-status");

  if (!form || !statusEl) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const initialButtonLabel = submitButton ? submitButton.textContent : "Submit Request";

  const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      goal: String(formData.get("goal") || "").trim(),
      message: String(formData.get("message") || "").trim(),
      consent: formData.get("consent") === "on",
      source: "website",
    };

    if (!payload.name || !payload.email || !payload.phone || !payload.goal || !payload.consent) {
      setStatus("Please complete all required fields and consent checkbox.", true);
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
    }
    setStatus("Submitting your request...");

    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const errorMessage = typeof body.error === "string" ? body.error : "Submission failed.";
        throw new Error(errorMessage);
      }

      setStatus("Request received. Check your email for next steps and portal access. Redirecting...");
      window.setTimeout(() => {
        window.location.href = "thank-you.html";
      }, 500);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "We could not submit your request. Please try again.",
        true
      );
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = initialButtonLabel;
      }
    }
  });
})();
