#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ================= WIFI =================
const char* ssid = "iPhone";
const char* password = "11337700";

// ================= TELEGRAM =================
String botToken = "8526182253:AAFn0E7Pp_vlK3EBkWQHI0YT3kdy55S_sfE";
String chatID  = "920102941";

// ================= MQTT =================
const char* mqtt_server = "broker.hivemq.com";
WiFiClient espClient;
PubSubClient client(espClient);

// ================= PIN =================
#define TRIG_PIN 5
#define ECHO_PIN 18
#define ONE_WIRE_BUS 4
#define PH_PIN 34

// ================= OBJECT =================
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// ================= VAR =================
long duration;
float distance;
bool sudahKirim = false;

// ================= FUNCTION =================
float readPHVoltage() {
  int samples = 10;
  float total = 0;

  for (int i = 0; i < samples; i++) {
    total += analogRead(PH_PIN);
    delay(10);
  }

  float avg = total / samples;
  return avg * (3.3 / 4095.0);
}

// ===== URL ENCODE =====
String urlEncode(String str) {
  String encoded = "";
  char c;
  char code0;
  char code1;

  for (int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (isalnum(c)) {
      encoded += c;
    } else {
      code1 = (c & 0xf) + '0';
      if ((c & 0xf) > 9) code1 = (c & 0xf) - 10 + 'A';
      c = (c >> 4) & 0xf;
      code0 = c + '0';
      if (c > 9) code0 = c - 10 + 'A';
      encoded += '%';
      encoded += code0;
      encoded += code1;
    }
  }
  return encoded;
}

// ===== TELEGRAM =====
void kirimTelegram(String pesan) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    String url = "https://api.telegram.org/bot" + botToken +
                 "/sendMessage?chat_id=" + chatID +
                 "&text=" + urlEncode(pesan);

    http.begin(url);
    int httpCode = http.GET();

    Serial.print("Telegram HTTP: ");
    Serial.println(httpCode);

    if (httpCode > 0) {
      Serial.println(http.getString());
    }

    http.end();
  }
}

// ===== MQTT CONNECT =====
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");

    if (client.connect("ESP32_LIMBAH")) {
      Serial.println("Connected MQTT");
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      Serial.println(" retry...");
      delay(2000);
    }
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  sensors.begin();

  // WIFI
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected");
  Serial.println(WiFi.localIP());

  // MQTT
  client.setServer(mqtt_server, 1883);
}

// ================= LOOP =================
void loop() {

  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  // ===== JARAK =====
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  duration = pulseIn(ECHO_PIN, HIGH);
  distance = duration * 0.034 / 2;

  // ===== SUHU =====
  sensors.requestTemperatures();
  float suhuC = sensors.getTempCByIndex(0);

  // ===== PH =====
  float voltage = readPHVoltage();
  float ph = 7 + ((2.5 - voltage) / 0.18);

  // ===== JSON PAYLOAD =====
  String payload = "{";
  payload += "\"jarak\":" + String(distance, 2) + ",";
  payload += "\"suhu\":" + String(suhuC, 2) + ",";
  payload += "\"ph\":" + String(ph, 2);
  payload += "}";

  // ===== KIRIM MQTT =====
  client.publish("limbah/data", payload.c_str());

  Serial.println("Kirim MQTT:");
  Serial.println(payload);

  // ===== TELEGRAM ALERT =====
  if (distance > 30) {
    if (!sudahKirim) {

      String pesan = "⚠️ PENAMPUNGAN PENUH\n";
      pesan += "Jarak: " + String(distance) + " cm\n";
      pesan += "Suhu: " + String(suhuC) + " C\n";
      pesan += "pH: " + String(ph);

      kirimTelegram(pesan);
      sudahKirim = true;
    }
  } else {
    sudahKirim = false;
  }

  Serial.println("----------------------\n");

  delay(3000);
}