import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
} from "react-native";
import { Accelerometer } from "expo-sensors";
import { StatusBar } from "expo-status-bar";

const SAMPLE_INTERVAL_MS = 20; // ~50 Hz
const LIVE_WINDOW = 40;
const CAPTURE_SAMPLES = 250;
const STABLE_SD_LIMIT = 0.06;
const DEFAULT_TOLERANCE = 0.05;

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 999;

  const avg = mean(values);
  const variance =
    values.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) /
    values.length;

  return Math.sqrt(variance);
}

function trimmedMean(values, trimPercent = 0.1) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * trimPercent);

  const trimmed =
    trim > 0 ? sorted.slice(trim, sorted.length - trim) : sorted;

  return mean(trimmed);
}

// Mounting standard:
//
// - Phone in portrait orientation
// - Top of phone points upward
// - Screen faces outward toward technician
// - Phone/fixture plane is parallel to wheel plane
//
// This measures camber from gravity.
function calculateCamberAngle({ x, y, z }) {
  return Math.atan2(z, -y) * (180 / Math.PI);
}

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.secondaryButtonText,
          disabled && styles.disabledButtonText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function HomeScreen({ setScreen }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.logo}>Alignpro</Text>
      <Text style={styles.subtitle}>Precision Wheel Alignment</Text>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>◉</Text>
        <Text style={styles.homeTitle}>Camber</Text>
        <Text style={styles.homeDescription}>
          Measure left and right wheels and match them precisely.
        </Text>

        <Button
          title="Measure Camber"
          onPress={() => setScreen("camber")}
        />
      </View>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>↔</Text>
        <Text style={styles.homeTitle}>Toe</Text>
        <Text style={styles.homeDescription}>
          Physical-reference toe measurement.
        </Text>

        <Button
          title="Toe Setup"
          onPress={() => setScreen("toe")}
        />
      </View>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>◎</Text>
        <Text style={styles.homeTitle}>Calibration</Text>
        <Text style={styles.homeDescription}>
          Zero the sensor and verify stability.
        </Text>

        <Button
          title="Calibration"
          secondary
          onPress={() => setScreen("calibration")}
        />
      </View>
    </ScrollView>
  );
}

function PlacementGuide() {
  return (
    <View style={styles.guideCard}>
      <Text style={styles.sectionTitle}>Fixture Placement</Text>

      <Text style={styles.guideText}>
        1. Install the phone firmly in the Alignpro wheel fixture.
      </Text>

      <Text style={styles.guideText}>
        2. Keep the phone vertical with the top pointing upward.
      </Text>

      <Text style={styles.guideText}>
        3. Keep the screen facing outward toward you.
      </Text>

      <Text style={styles.guideText}>
        4. Seat the fixture against the same rim-contact points every time.
      </Text>

      <Text style={styles.guideText}>
        5. Wait for STABLE before capturing.
      </Text>
    </View>
  );
}

function CamberScreen({
  liveAngle,
  stability,
  stable,
  captureProgress,
  captureTarget,
  captureWheel,
  leftReading,
  rightReading,
  clearMeasurements,
  zeroSensor,
  referenceSide,
  setReferenceSide,
  arrowFlipped,
  tolerance,
  setScreen,
}) {
  const bothMeasured =
    leftReading !== null && rightReading !== null;

  let reference = null;
  let current = null;
  let correction = null;
  let matched = false;
  let direction = null;

  if (bothMeasured) {
    reference =
      referenceSide === "left"
        ? leftReading
        : rightReading;

    current =
      referenceSide === "left"
        ? rightReading
        : leftReading;

    correction = reference - current;
    matched = Math.abs(correction) <= tolerance;

    if (!matched) {
      const needsIncrease = correction > 0;

      if (!arrowFlipped) {
        direction = needsIncrease ? "RIGHT" : "LEFT";
      } else {
        direction = needsIncrease ? "LEFT" : "RIGHT";
      }
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Camber</Text>

      <PlacementGuide />

      <View style={styles.liveCard}>
        <Text style={styles.label}>LIVE ANGLE</Text>

        <Text style={styles.liveAngle}>
          {liveAngle >= 0 ? "+" : ""}
          {liveAngle.toFixed(2)}°
        </Text>

        <Text
          style={[
            styles.stabilityText,
            stable ? styles.greenText : styles.redText,
          ]}
        >
          {stable ? "● STABLE" : "● HOLD STILL"}
        </Text>

        <Text style={styles.smallText}>
          Variation ±{stability.toFixed(3)}°
        </Text>
      </View>

      {captureTarget !== null && (
        <View style={styles.captureCard}>
          <Text style={styles.captureTitle}>
            Capturing{" "}
            {captureTarget === "left"
              ? "LEFT"
              : "RIGHT"}{" "}
            wheel
          </Text>

          <Text style={styles.captureProgress}>
            {captureProgress} / {CAPTURE_SAMPLES}
          </Text>

          <Text style={styles.smallText}>
            Keep fixture still
          </Text>
        </View>
      )}

      <View style={styles.twoColumns}>
        <View style={styles.wheelCard}>
          <Text style={styles.wheelTitle}>LEFT WHEEL</Text>

          <Text style={styles.wheelReading}>
            {leftReading === null
              ? "--.--°"
              : `${leftReading >= 0 ? "+" : ""}${leftReading.toFixed(
                  2
                )}°`}
          </Text>

          <Button
            title="Capture Left"
            disabled={!stable || captureTarget !== null}
            onPress={() => captureWheel("left")}
          />
        </View>

        <View style={styles.wheelCard}>
          <Text style={styles.wheelTitle}>RIGHT WHEEL</Text>

          <Text style={styles.wheelReading}>
            {rightReading === null
              ? "--.--°"
              : `${rightReading >= 0 ? "+" : ""}${rightReading.toFixed(
                  2
                )}°`}
          </Text>

          <Button
            title="Capture Right"
            disabled={!stable || captureTarget !== null}
            onPress={() => captureWheel("right")}
          />
        </View>
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.sectionTitle}>Reference Wheel</Text>

        <View style={styles.referenceButtons}>
          <Pressable
            style={[
              styles.referenceButton,
              referenceSide === "left" &&
                styles.referenceButtonSelected,
            ]}
            onPress={() => setReferenceSide("left")}
          >
            <Text style={styles.referenceButtonText}>
              LEFT
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.referenceButton,
              referenceSide === "right" &&
                styles.referenceButtonSelected,
            ]}
            onPress={() => setReferenceSide("right")}
          >
            <Text style={styles.referenceButtonText}>
              RIGHT
            </Text>
          </Pressable>
        </View>
      </View>

      {bothMeasured && (
        <View
          style={[
            styles.correctionCard,
            matched
              ? styles.correctionGood
              : styles.correctionBad,
          ]}
        >
          <Text style={styles.correctionLabel}>
            CORRECTION NEEDED
          </Text>

          {matched ? (
            <>
              <Text style={[styles.bigArrow, styles.greenText]}>
                ✓
              </Text>

              <Text
                style={[
                  styles.correctionDirection,
                  styles.greenText,
                ]}
              >
                MATCH
              </Text>

              <Text style={styles.correctionAmount}>
                Difference {Math.abs(correction).toFixed(2)}°
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.bigArrow, styles.redText]}>
                {direction === "RIGHT" ? "→" : "←"}
              </Text>

              <Text
                style={[
                  styles.correctionDirection,
                  styles.redText,
                ]}
              >
                MOVE TOP {direction}
              </Text>

              <Text style={styles.correctionAmount}>
                {Math.abs(correction).toFixed(2)}°
              </Text>

              <Text style={styles.smallText}>
                Adjust the non-reference wheel until this turns green.
              </Text>
            </>
          )}
        </View>
      )}

      <View style={styles.actionsCard}>
        <Button
          title="Zero / Calibrate"
          secondary
          onPress={zeroSensor}
        />

        <Button
          title="Clear Measurements"
          secondary
          onPress={clearMeasurements}
        />
      </View>

      <Text style={styles.disclaimer}>
        0.01° is display resolution, not validated absolute accuracy.
      </Text>
    </ScrollView>
  );
}

function ToeScreen({ setScreen }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Toe</Text>

      <View style={styles.guideCard}>
        <Text style={styles.sectionTitle}>
          Precision Toe Mode
        </Text>

        <Text style={styles.guideText}>
          Toe will not use the magnetic compass.
        </Text>

        <Text style={styles.guideText}>
          Each wheel will be referenced against the same physical
          alignment bar, string, or calibrated fixture.
        </Text>

        <Text style={styles.comingSoon}>
          Toe measurement module coming next.
        </Text>
      </View>
    </ScrollView>
  );
}

function CalibrationScreen({
  setScreen,
  liveAngle,
  rawAngle,
  stability,
  stable,
  zeroSensor,
  arrowFlipped,
  setArrowFlipped,
}) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Calibration</Text>

      <View style={styles.liveCard}>
        <Text style={styles.label}>CORRECTED ANGLE</Text>
        <Text style={styles.calValue}>
          {liveAngle.toFixed(3)}°
        </Text>

        <Text style={styles.label}>RAW SENSOR ANGLE</Text>
        <Text style={styles.calValue}>
          {rawAngle.toFixed(3)}°
        </Text>

        <Text style={styles.label}>
          SHORT-TERM VARIATION
        </Text>
        <Text style={styles.calValue}>
          ±{stability.toFixed(3)}°
        </Text>

        <Text
          style={[
            styles.stabilityText,
            stable ? styles.greenText : styles.redText,
          ]}
        >
          {stable
            ? "SENSOR STABLE"
            : "MOVEMENT DETECTED"}
        </Text>
      </View>

      <Button title="Zero Sensor" onPress={zeroSensor} />

      <View style={styles.guideCard}>
        <Text style={styles.sectionTitle}>
          Arrow Direction
        </Text>

        <Text style={styles.guideText}>
          If the physical fixture causes the displayed direction to be
          reversed, flip the arrow mapping here.
        </Text>

        <Button
          title={
            arrowFlipped
              ? "Arrow Mapping: FLIPPED"
              : "Arrow Mapping: NORMAL"
          }
          secondary
          onPress={() => setArrowFlipped(!arrowFlipped)}
        />
      </View>
    </ScrollView>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");

  const [liveAngle, setLiveAngle] = useState(0);
  const [rawAngle, setRawAngle] = useState(0);
  const [stability, setStability] = useState(999);
  const [stable, setStable] = useState(false);

  const [leftReading, setLeftReading] = useState(null);
  const [rightReading, setRightReading] = useState(null);

  const [referenceSide, setReferenceSide] =
    useState("left");

  const [captureTarget, setCaptureTarget] =
    useState(null);

  const [captureProgress, setCaptureProgress] =
    useState(0);

  const [arrowFlipped, setArrowFlipped] =
    useState(false);

  const zeroOffsetRef = useRef(0);

  const liveBufferRef = useRef([]);
  const captureBufferRef = useRef([]);
  const captureTargetRef = useRef(null);

  useEffect(() => {
    let subscription;

    async function startSensor() {
      const available =
        await Accelerometer.isAvailableAsync();

      if (!available) return;

      Accelerometer.setUpdateInterval(
        SAMPLE_INTERVAL_MS
      );

      subscription = Accelerometer.addListener(
        (sensorData) => {
          const raw = calculateCamberAngle(sensorData);

          setRawAngle(raw);

          const corrected =
            raw - zeroOffsetRef.current;

          liveBufferRef.current.push(corrected);

          if (
            liveBufferRef.current.length >
            LIVE_WINDOW
          ) {
            liveBufferRef.current.shift();
          }

          const liveValues =
            liveBufferRef.current;

          if (liveValues.length >= 10) {
            const average =
              trimmedMean(liveValues);

            const sd = stdDev(liveValues);

            setLiveAngle(average);
            setStability(sd);
            setStable(sd <= STABLE_SD_LIMIT);
          }

          if (captureTargetRef.current) {
            captureBufferRef.current.push(
              corrected
            );

            setCaptureProgress(
              captureBufferRef.current.length
            );

            if (
              captureBufferRef.current.length >=
              CAPTURE_SAMPLES
            ) {
              const finalReading =
                trimmedMean(
                  captureBufferRef.current
                );

              if (
                captureTargetRef.current === "left"
              ) {
                setLeftReading(finalReading);
              } else {
                setRightReading(finalReading);
              }

              captureBufferRef.current = [];
              captureTargetRef.current = null;

              setCaptureTarget(null);
              setCaptureProgress(0);
            }
          }
        }
      );
    }

    startSensor();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  function zeroSensor() {
    zeroOffsetRef.current = rawAngle;

    liveBufferRef.current = [];

    setLiveAngle(0);
    setStability(999);
    setStable(false);
  }

  function captureWheel(side) {
    if (!stable) return;

    captureBufferRef.current = [];
    captureTargetRef.current = side;

    setCaptureTarget(side);
    setCaptureProgress(0);
  }

  function clearMeasurements() {
    setLeftReading(null);
    setRightReading(null);

    captureBufferRef.current = [];
    captureTargetRef.current = null;

    setCaptureTarget(null);
    setCaptureProgress(0);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      {screen === "home" && (
        <HomeScreen setScreen={setScreen} />
      )}

      {screen === "camber" && (
        <CamberScreen
          liveAngle={liveAngle}
          stability={stability}
          stable={stable}
          captureProgress={captureProgress}
          captureTarget={captureTarget}
          captureWheel={captureWheel}
          leftReading={leftReading}
          rightReading={rightReading}
          clearMeasurements={clearMeasurements}
          zeroSensor={zeroSensor}
          referenceSide={referenceSide}
          setReferenceSide={setReferenceSide}
          arrowFlipped={arrowFlipped}
          tolerance={DEFAULT_TOLERANCE}
          setScreen={setScreen}
        />
      )}

      {screen === "toe" && (
        <ToeScreen setScreen={setScreen} />
      )}

      {screen === "calibration" && (
        <CalibrationScreen
          setScreen={setScreen}
          liveAngle={liveAngle}
          rawAngle={rawAngle}
          stability={stability}
          stable={stable}
          zeroSensor={zeroSensor}
          arrowFlipped={arrowFlipped}
          setArrowFlipped={setArrowFlipped}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#081018",
  },

  screen: {
    padding: 20,
    paddingBottom: 50,
  },

  logo: {
    color: "white",
    fontSize: 38,
    fontWeight: "800",
  },

  subtitle: {
    color: "#95a4b6",
    fontSize: 16,
    marginBottom: 25,
  },

  pageTitle: {
    color: "white",
    fontSize: 32,
    fontWeight: "800",
    marginBottom: 20,
  },

  back: {
    color: "#4aa3ff",
    fontSize: 18,
    marginBottom: 15,
  },

  homeCard: {
    backgroundColor: "#111b25",
    borderRadius: 18,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#243240",
  },

  homeIcon: {
    color: "#4aa3ff",
    fontSize: 30,
    marginBottom: 8,
  },

  homeTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "700",
  },

  homeDescription: {
    color: "#a7b2c0",
    marginVertical: 10,
    lineHeight: 22,
  },

  button: {
    backgroundColor: "#1585ff",
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center",
    marginTop: 12,
  },

  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },

  secondaryButton: {
    backgroundColor: "#1b2632",
    borderWidth: 1,
    borderColor: "#344454",
  },

  secondaryButtonText: {
    color: "#dbe7f3",
  },

  disabledButton: {
    opacity: 0.4,
  },

  disabledButtonText: {
    color: "#7b8794",
  },

  guideCard: {
    backgroundColor: "#111b25",
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },

  sectionTitle: {
    color: "white",
    fontSize: 19,
    fontWeight: "700",
    marginBottom: 12,
  },

  guideText: {
    color: "#c0cad4",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },

  liveCard: {
    backgroundColor: "#111b25",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    marginBottom: 18,
  },

  label: {
    color: "#8594a4",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 10,
  },

  liveAngle: {
    color: "white",
    fontSize: 64,
    fontWeight: "800",
  },

  stabilityText: {
    fontWeight: "800",
    marginTop: 8,
  },

  smallText: {
    color: "#9ba8b6",
    marginTop: 8,
    textAlign: "center",
  },

  greenText: {
    color: "#31d47b",
  },

  redText: {
    color: "#ff4d57",
  },

  captureCard: {
    backgroundColor: "#182838",
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    alignItems: "center",
  },

  captureTitle: {
    color: "white",
    fontWeight: "700",
    fontSize: 17,
  },

  captureProgress: {
    color: "#4aa3ff",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 8,
  },

  twoColumns: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },

  wheelCard: {
    flex: 1,
    backgroundColor: "#111b25",
    borderRadius: 18,
    padding: 15,
  },

  wheelTitle: {
    color: "#9ba8b6",
    fontWeight: "700",
    fontSize: 13,
  },

  wheelReading: {
    color: "white",
    fontSize: 28,
    fontWeight: "800",
    marginTop: 10,
  },

  referenceCard: {
    backgroundColor: "#111b25",
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },

  referenceButtons: {
    flexDirection: "row",
    gap: 10,
  },

  referenceButton: {
    flex: 1,
    padding: 13,
    borderRadius: 12,
    backgroundColor: "#1d2a36",
    alignItems: "center",
  },

  referenceButtonSelected: {
    backgroundColor: "#176fc7",
  },

  referenceButtonText: {
    color: "white",
    fontWeight: "800",
  },

  correctionCard: {
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    marginBottom: 18,
    borderWidth: 1,
  },

  correctionGood: {
    backgroundColor: "#0f2b20",
    borderColor: "#31d47b",
  },

  correctionBad: {
    backgroundColor: "#31171a",
    borderColor: "#ff4d57",
  },

  correctionLabel: {
    color: "#b8c2cd",
    fontSize: 13,
    fontWeight: "700",
  },

  bigArrow: {
    fontSize: 90,
    fontWeight: "900",
    lineHeight: 100,
  },

  correctionDirection: {
    fontSize: 25,
    fontWeight: "900",
  },

  correctionAmount: {
    color: "white",
    fontSize: 35,
    fontWeight: "800",
    marginTop: 4,
  },

  actionsCard: {
    marginBottom: 20,
  },

  disclaimer: {
    color: "#657280",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },

  comingSoon: {
    color: "#4aa3ff",
    fontWeight: "700",
    marginTop: 15,
  },

  calValue: {
    color: "white",
    fontSize: 26,
    fontWeight: "700",
  },
});
