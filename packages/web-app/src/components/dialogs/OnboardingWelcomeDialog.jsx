/* OnboardingWelcomeDialog — first-visit modal offering Continue / Skip.
 *
 * Keep this modal intentionally quiet. The detailed product education lives
 * in the replayable spotlight tour so first-run and replay use the same path.
 */
import React from "react";
import { Sparkles, X } from "lucide-react";
import {
  startOnboardingTour,
  markTourSeen,
} from "../../lib/onboardingTour";

export default function OnboardingWelcomeDialog({ onClose }) {
  const handleContinue = () => {
    onClose?.();
    setTimeout(() => startOnboardingTour(), 60);
  };

  const handleSkip = () => {
    markTourSeen();
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.58)",
        backdropFilter: "blur(5px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={handleSkip}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 94vw)",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "var(--shadow-pop)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={handleSkip}
          title="Skip onboarding"
          aria-label="Skip onboarding"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "transparent",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 7,
            borderRadius: 7,
          }}
        >
          <X size={16} />
        </button>

        <div style={{ padding: "30px 32px 22px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px",
              borderRadius: 999,
              background: "rgba(59,130,246,0.12)",
              color: "#60a5fa",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            <Sparkles size={12} /> Guided onboarding
          </div>

          <h2
            id="onboarding-title"
            style={{
              fontSize: 25,
              lineHeight: 1.18,
              fontWeight: 700,
              margin: 0,
              color: "var(--text-primary)",
              letterSpacing: 0,
            }}
          >
            Welcome to DataLex
          </h2>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 14,
              lineHeight: 1.65,
              color: "var(--text-secondary)",
            }}
          >
            DataLex helps teams turn dbt projects into governed, AI-ready analytics models.
            It keeps business meaning, relationships, standards, and YAML fixes close to the files your team already owns.
          </p>
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--text-tertiary)",
            }}
          >
            The tour starts with the dbt problem, then shows the DataLex solution and the product workflow step by step.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "16px 22px",
            borderTop: "1px solid var(--border-default)",
            background: "var(--bg-1)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={handleSkip}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleContinue}
            autoFocus
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--accent, #3b82f6)",
              background: "var(--accent, #3b82f6)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Start tour
          </button>
        </div>
      </div>
    </div>
  );
}
