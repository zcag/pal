// `.proto` files imported as text (`with { type: "text" }`), protos.ts.
declare module "*.proto" {
  const text: string;
  export default text;
}
