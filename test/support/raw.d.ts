// Vite ?raw imports, used by the package tests to read built files
declare module '*?raw' {
  const content: string;
  export default content;
}
