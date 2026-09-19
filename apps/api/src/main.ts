import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { WsAdapter } from "@nestjs/platform-ws";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters";

async function bootstrap() {
  // bodyParser:false —— 我们手动按序注册 body parser。原因:下方给 fl-rounds 单独
  // app.use(json()) 后,Nest 的「已注册则跳过」逻辑会导致它不再注册全局 parser,
  // 使 login/register 等所有其它 POST 路由读不到请求体(400 account/password 缺失)。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Behind nginx/Cloudflare every request arrives from the proxy's IP, so the
  // per-IP ThrottlerGuard would put the whole internet in one 20 req/s bucket
  // (and its 429s carry no CORS headers, surfacing in the browser as a bogus
  // CORS failure). Trust the proxy chain so `req.ip` is the real client.
  // TRUST_PROXY: number of proxy hops, or an express `trust proxy` value.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    const hops = Number(trustProxy);
    app.set("trust proxy", Number.isFinite(hops) ? hops : trustProxy);
  }

  // Raw-WebSocket adapter so SecretFlow training logs stream to plain browser
  // `new WebSocket('…/ws/secretflow')` clients (not socket.io).
  app.useWebSocketAdapter(new WsAdapter(app));

  // Enable CORS. Production requires an explicit FRONTEND_URL (P0-10).
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (process.env.NODE_ENV === "production" && !frontendUrl) {
    throw new Error(
      "FRONTEND_URL must be set in production — refusing to start with an insecure default CORS origin.",
    );
  }
  app.enableCors({
    origin: frontendUrl || "http://localhost:5020",
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter — consistent JSON error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Graceful shutdown on SIGTERM / SIGINT
  app.enableShutdownHooks();

  // API prefix
  app.setGlobalPrefix("api/v1");

  // 联邦训练轮次结果单独放宽请求体上限（LoRA 增量可达数 MB，全局缺省 100kb 装不下）。
  // 注册在 Nest 全局 body parser 之前，命中该路径的请求由这里解析（其余路径不受影响）。
  app.use("/api/v1/connector/fl-rounds", json({ limit: "10mb" }));
  // 全局 body parser（fl-rounds 之后注册：命中 fl-rounds 的请求已被上面解析，其余走这里）。
  app.use(json({ limit: "2mb" }));
  app.use(urlencoded({ extended: true, limit: "2mb" }));

  // Swagger documentation. Production: opt-in via SWAGGER_ENABLED=true (P0-10).
  const swaggerEnabled = process.env.SWAGGER_ENABLED
    ? process.env.SWAGGER_ENABLED === "true"
    : process.env.NODE_ENV !== "production";
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle("MedTrust API")
      .setDescription("Medical Data Trusted Space Platform API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT || 5021;
  await app.listen(port);
  console.log(`MedTrust API running on port ${port}`);
  if (swaggerEnabled) {
    console.log(`API Documentation: http://localhost:${port}/api/docs`);
  }
}
bootstrap();
