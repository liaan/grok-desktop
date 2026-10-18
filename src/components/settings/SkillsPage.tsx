import { useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n";

function skillRowDetail(s: {
  description?: string;
  source?: string;
}): string {
  return [s.source || null, s.description || null].filter(Boolean).join(" · ");
}

export function SkillsPage({
  open,
  skills,
  error,
  loading,
  focus,
}: {
  open: boolean;
  skills: Array<{ name: string; description?: string; source?: string }>;
  error?: string | null;
  loading?: boolean;
  focus: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (open && focus) {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, [open, focus]);

  return (
    <section className="settings-section" ref={sectionRef} id="settings-skills">
      <h3>{t("nav.skills")}</h3>
      <p className="settings-desc settings-lead">{t("skills.lead")}</p>
      {loading ? <p className="settings-desc">{t("skills.loading")}</p> : null}
      {!loading && skills.length === 0 && !error ? (
        <p className="settings-desc">{t("skills.none")}</p>
      ) : null}
      {skills.map((s) => (
        <div className="settings-row mcp-row" key={s.name}>
          <div className="settings-row-text">
            <span className="settings-label">/{s.name}</span>
            <span className="settings-desc">{skillRowDetail(s)}</span>
          </div>
        </div>
      ))}
      {error ? (
        <span className="settings-desc settings-note">{error}</span>
      ) : null}
    </section>
  );
}
