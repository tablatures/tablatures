module.exports = {
  transpileDependencies: ["vuetify"],
  publicPath: process.env.NODE_ENV === "production" ? "/Tablatures/" : "/",
  devServer: {
    disableHostCheck: true,
    port: 8080,
    public: "0.0.0.0:8080",
  },
}
