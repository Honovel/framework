import {createDecorator, JwtPayload, UnauthorizedException} from "../core";


export const CurrentUser = createDecorator([JwtPayload], async (_context, jwt) => {
  await wait(1000);
  return jwt.sub;
})


export const Can = createDecorator([CurrentUser], async (_context, user, _permission: string) => {
  if (user === "flo")
    return true;
  throw new UnauthorizedException();
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));