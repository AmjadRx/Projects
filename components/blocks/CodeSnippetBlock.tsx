import CodeBlock from '@/components/viewers/code/CodeBlock';
import { hasText } from '@/lib/format';

export default function CodeSnippetBlock({ language, code, repoUrl }: { language: string; code: string; repoUrl?: string }) {
  if (!hasText(code)) return null;
  return <CodeBlock language={language} code={code} repoUrl={hasText(repoUrl) ? repoUrl : undefined} />;
}
