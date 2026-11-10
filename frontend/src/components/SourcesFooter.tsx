import { useI18n } from '../i18n';

interface SourcesFooterProps {
  /** Open precision from the latest audit; null or undefined hides it. */
  openPrecision?: number | null;
}

/**
 * Site footer: what the site does, the analytics note and the accuracy line.
 * It deliberately doesn't list where roles come from; each role names its
 * source on its own "Apply on …" button, which is the credit the job boards'
 * terms ask for.
 */
export function SourcesFooter({ openPrecision }: SourcesFooterProps) {
  const { t, fmt } = useI18n();
  return (
    <footer className="footer" id="sources">
      <div className="footer__inner">
        <div className="footer__about">
          <p className="footer__brand">job-radar</p>
          <p>{t.footer.about}</p>
          <p>{t.footer.analytics}</p>
          {openPrecision != null && <p className="footer__trust">{t.footer.precision(fmt.percent(openPrecision))}</p>}
        </div>
      </div>
    </footer>
  );
}
