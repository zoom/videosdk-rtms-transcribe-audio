import KJUR from "jsrsasign";

// used to generate a JWT for the web app to join the RTMS session
export const generateSignatureForWebApp = (sessionName: string, sdkKey: string, sdkSecret: string): string => {
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

export type SampleAudioPacket = {
  msg_type: 14;
  content: {
    user_id?: number;
    user_name?: string;
    channel_id?: string;
    data: string;
    timestamp: number;
    // Source-specific fields pass through to Scribe as opaque metadata.
    [key: string]: unknown;
  };
};
