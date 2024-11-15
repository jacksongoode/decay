export function isLocalhost(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname)
    );
  }