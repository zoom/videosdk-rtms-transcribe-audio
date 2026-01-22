import KJUR from "jsrsasign";

// !!You should sign your JWT with a backend service in a production use-case!!
const sdkKey = import.meta.env.VITE_SDK_KEY as string;
const sdkSecret = import.meta.env.VITE_SDK_SECRET as string;

if (!sdkKey || !sdkSecret) {
  alert("Please enter SDK Key and SDK Secret in the .env file");
  throw new Error("SDK Key and SDK Secret are required");
}
// You should sign your JWT with a backend service in a production use-case
export const generateSignature = (sessionName: string): string => {
  const iat = Math.round(new Date().getTime() / 1000) - 30;
  const exp = iat + 60 * 60 * 2;
  const oHeader = { alg: "HS256", typ: "JWT" };

  const oPayload = {
    app_key: sdkKey,
    tpc: sessionName,
    role_type: 1,
    version: 1,
    iat: iat,
    exp: exp,
  };

  const sHeader = JSON.stringify(oHeader);
  const sPayload = JSON.stringify(oPayload);
  const sdkJWT = KJUR.KJUR.jws.JWS.sign("HS256", sHeader, sPayload, sdkSecret);
  console.log(sdkJWT);
  return sdkJWT;
};
