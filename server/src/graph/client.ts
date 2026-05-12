import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";
import { getAccessTokenForUser } from "../auth/account.js";

export function graphFor(upn: string): Client {
  return Client.init({
    authProvider: (done) => {
      getAccessTokenForUser(upn)
        .then((token) => done(null, token))
        .catch((err) => done(err, null));
    },
  });
}
