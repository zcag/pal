// The `turkish-deasciifier` package ships no types: a constructor whose
// instance deasciifies a string (Mustafa Emre Acer's port of Deniz Yüret's
// Emacs turkish-mode; `deasciifyRange` and the internals are not used).
declare module "turkish-deasciifier" {
  const Deasciifier: new () => { deasciify(text: string): string };
  export default Deasciifier;
}
