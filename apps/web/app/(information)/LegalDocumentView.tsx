'use client';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { LEGAL_DETAILS_INCOMPLETE, LEGAL_LAST_UPDATED } from '@/lib/legal';
import type { LocalisedDocument } from '@/lib/legalContent';

export function LegalDocumentView({ document }: { document: LocalisedDocument }) {
  const { locale, t } = useLanguage();
  const doc = document[locale];

  return (
    <>
      <h1 className="info__title">{doc.title}</h1>
      <p className="info__lede">{doc.lede}</p>

      <p className="info__note">
        <b>{t('legal.updatedLabel')}</b>
        <span>{LEGAL_LAST_UPDATED}</span>
      </p>

      {LEGAL_DETAILS_INCOMPLETE && (
        <p className="info__note info__note--age">
          <b>{t('legal.draftLabel')}</b>
          <span>{t('legal.draftBody')}</span>
        </p>
      )}

      {doc.sections.map((section) => (
        <section className="info__section" id={section.id} key={section.id}>
          <h2>{section.heading}</h2>

          {section.paragraphs?.map((text) => (
            <p key={text}>{text}</p>
          ))}

          {section.bullets && (
            <ul className="info__list">
              {section.bullets.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
