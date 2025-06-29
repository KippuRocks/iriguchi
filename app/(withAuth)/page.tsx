"use client";

import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Typography,
} from "@mui/material";
import { useCallback, useContext, useEffect, useState } from "react";

import BarcodeReader from "@/app/_components/BarcodeReader";
import ConfirmationFailedScreen from "@/app/_components/ConfirmationFailedScreen";
import { ConfirmationPassedScreen } from "@/app/_components/ConfirmationPassedScreen";
import QrCodeIcon from "@mui/icons-material/QrCode";
import QrScanner from "@/app/_components/QRScanner";
import { TickettoClientContext } from "@/app/providers/TickettoClientProvider";
import UsbIcon from "@mui/icons-material/Usb";
import { useTranslations } from "next-intl";

export default function Validate() {
  const t = useTranslations<string>("Validate");
  const [isReaderOpened, setIsReaderOpened] = useState(false);
  const [isBarcodeOpened, setIsBarcodeOpened] = useState(false);
  const [isSuccessOpened, setIsSuccessOpened] = useState(false);
  const [isFailOpened, setIsFailOpened] = useState(false);
  const client = useContext(TickettoClientContext);
  const validateCode = useCallback(
    async (input: Uint8Array) => {
      try {
        await client?.tickets.calls.submitAttendanceCall(input);
        setIsSuccessOpened(true);
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = 800;
        oscillator.connect(context.destination);
        oscillator.start();
        // Beep for 500 milliseconds
        setTimeout(function () {
          oscillator.stop();
        }, 100);
      } catch {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = 800;
        oscillator.connect(context.destination);
        oscillator.start();
        // Beep for 500 milliseconds
        setTimeout(function () {
          oscillator.stop();
          // Beep for 500 milliseconds
          const oscillator2 = context.createOscillator();
          oscillator2.type = "sine";
          oscillator2.frequency.value = 800;
          oscillator2.connect(context.destination);
          oscillator2.start();
          setTimeout(function () {
            oscillator2.stop();
          }, 300);
        }, 300);

        setIsFailOpened(true);
      }
    },
    [client]
  );

  useEffect(() => {
    if (!isReaderOpened) {
      window.dispatchEvent(new Event("stopVideo"));
    }
  }, [isReaderOpened]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        px: 3,
        py: 2,
      }}
    >
      <h1>{t("validateTitle")}</h1>
      <Box
        sx={{
          flex: { md: "wrap", xs: "nowrap" },
        }}
        display="flex"
        gap={4}
      >
        <Card
          sx={{
            width: {
              md: 180,
              xs: "100%",
            },
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <CardActionArea
            sx={{
              display: "flex",
              flexDirection: "column",
              padding: 1,
              height: "100%",
            }}
            onClick={() => {
              setIsReaderOpened(true);
            }}
          >
            <QrCodeIcon sx={{ height: 64, width: 64 }} />
            <CardContent>
              <Typography
                variant="h6"
                align="center"
                sx={{ fontSize: "12px", opacity: 0.85 }}
              >
                {t("scanWithCamera")}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card
          sx={{
            width: {
              md: 180,
              xs: "100%",
            },
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <CardActionArea
            sx={{
              display: "flex",
              flexDirection: "column",
              padding: 1,
              height: "100%",
            }}
            onClick={() => setIsBarcodeOpened(true)}
          >
            <UsbIcon sx={{ height: 64, width: 64 }} />
            <CardContent>
              <Typography
                variant="h6"
                align="center"
                sx={{ fontSize: "12px", opacity: 0.85 }}
              >
                {t("scanWithReader.title")}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>
      {isBarcodeOpened && (
        <BarcodeReader
          message={t("scanWithReader.description")}
          onBarcode={(res) => {
            validateCode(res);
          }}
          onClose={() => {
            setIsBarcodeOpened(false);
          }}
        />
      )}

      {isReaderOpened && (
        <QrScanner
          onClose={() => {
            setIsReaderOpened(false);
          }}
          onResult={(res) => {
            validateCode(res);
          }}
        />
      )}
      {isSuccessOpened && (
        <ConfirmationPassedScreen
          onClose={() => {
            setIsSuccessOpened(false);
          }}
        />
      )}
      {isFailOpened && (
        <ConfirmationFailedScreen
          onClose={() => {
            setIsFailOpened(false);
          }}
        />
      )}
    </Box>
  );
}
