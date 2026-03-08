(() => {
  const form = document.getElementById("lead-form");
  const statusEl = document.getElementById("form-status");

  if (!form || !statusEl) return;

  const isSpanish = document.documentElement.lang.toLowerCase().startsWith("es");
  const copy = isSpanish
    ? {
        submitLabel: "Enviar solicitud",
        validationError: "Complete todos los campos requeridos y la casilla de consentimiento.",
        submittingLabel: "Enviando...",
        submittingStatus: "Enviando su solicitud...",
        successStatus:
          "Solicitud recibida. Revise su correo para los próximos pasos y acceso al portal. Redirigiendo...",
        errorFallback: "No pudimos enviar su solicitud. Inténtelo nuevamente.",
        redirectTarget: "thank-you-es.html",
        source: "website-es",
      }
    : {
        submitLabel: "Submit Request",
        validationError: "Please complete all required fields and consent checkbox.",
        submittingLabel: "Submitting...",
        submittingStatus: "Submitting your request...",
        successStatus:
          "Request received. Check your email for next steps and portal access. Redirecting...",
        errorFallback: "We could not submit your request. Please try again.",
        redirectTarget: "thank-you.html",
        source: "website",
      };

  const submitButton = form.querySelector('button[type="submit"]');
  const initialButtonLabel = submitButton ? submitButton.textContent : copy.submitLabel;

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
      source: copy.source,
    };

    if (!payload.name || !payload.email || !payload.phone || !payload.goal || !payload.consent) {
      setStatus(copy.validationError, true);
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = copy.submittingLabel;
    }
    setStatus(copy.submittingStatus);

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

      setStatus(copy.successStatus);
      window.setTimeout(() => {
        window.location.href = copy.redirectTarget;
      }, 500);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : copy.errorFallback,
        true
      );
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = initialButtonLabel;
      }
    }
  });
})();
