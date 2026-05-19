const script = `
(function() {
  try {
    var ls = localStorage.getItem('theme');
    var pref = ls || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', pref);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
