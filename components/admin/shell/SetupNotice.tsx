'use client';

/**
 * Shown instead of the admin when the server answers 503 not-configured (ARCHITECTURE.md 11:
 * no fallback credentials). It names the missing variables and says where to set them; it never
 * shows or asks for a value.
 */
import { Notice } from '../ui/bits';

const KNOWN_NOTES: Record<string, string> = {
  ADMIN_PASSWORD: 'the admin password; use a long one from a password manager.',
  SESSION_SECRET: 'at least 32 random characters that sign the session cookie; generate it in your own terminal or password manager.',
};

export function SetupNotice({ missing, message }: { missing: string[]; message?: string }) {
  const names = missing.length > 0 ? missing : ['ADMIN_PASSWORD', 'SESSION_SECRET'];
  return (
    <main className="adm-gate">
      <div className="adm-gate__card adm-gate__card--wide">
        <h1 className="adm-gate__title">The admin is not set up here</h1>
        <p className="adm-gate__text">
          This deployment is missing {names.length === 1 ? 'a variable' : 'variables'} the admin needs, so every admin route answers
          503 and nothing can be edited. There is no fallback password.
        </p>
        <Notice tone="warning" title={names.length === 1 ? 'Missing variable' : 'Missing variables'}>
          <ul className="adm-plainlist">
            {names.map((name) => (
              <li key={name}>
                <code className="adm-code">{name}</code>
                {KNOWN_NOTES[name] ? `: ${KNOWN_NOTES[name]}` : null}
              </li>
            ))}
          </ul>
        </Notice>
        <h2 className="adm-gate__subtitle">How to set them</h2>
        <ol className="adm-steps">
          <li>
            On Vercel: open the project, then Settings, then Environment Variables. Add each one for this environment (Production or
            Preview), then redeploy; a deployment only sees the variables that existed when it was built.
          </li>
          <li>On this computer: add them to .env.local in the repository folder and restart the dev server.</li>
          <li>Never paste a value into a chat, an issue, or a commit.</li>
        </ol>
        {message ? <p className="adm-gate__note">The server said: {message}</p> : null}
        <p className="adm-gate__foot">
          <a className="adm-link" href="/">
            Back to the site
          </a>
        </p>
      </div>
    </main>
  );
}
