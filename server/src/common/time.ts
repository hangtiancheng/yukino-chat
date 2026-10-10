import dayjs from "dayjs";

export const fmtDateTime = (d: Date) => dayjs(d).format("YYYY-MM-DD HH:mm:ss");

export const fmtYMD = (d: Date) => dayjs(d).format("YYYY.M.D");

export const nowDate = () => new Date();
