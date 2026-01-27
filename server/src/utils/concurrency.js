const userLocks = {};

export const getUserLock = (username) => {
  if (!userLocks[username]) {
    let p = Promise.resolve();
    userLocks[username] = {
      run: (fn) => {
        const res = p.then(() => fn());
        p = res.catch(() => {});
        return res;
      },
    };
  }
  return userLocks[username];
};
