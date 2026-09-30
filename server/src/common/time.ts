import dayjs from "dayjs";

// Go formats timestamps in server-local time; dayjs is local by default too.
export const fmtDateTime = (d: Date) => dayjs(d).format("YYYY-MM-DD HH:mm:ss");

export const fmtYMD = (d: Date) => dayjs(d).format("YYYY.M.D");

export const nowDate = () => new Date();
