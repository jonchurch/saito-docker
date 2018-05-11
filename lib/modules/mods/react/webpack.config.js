var path = require('path');
var webpack = require('webpack');
var HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    devtool: 'inline-source-app',
    // context: path.resolve(__dirname, '..'),
    entry:  ['./build/app/index.js'],
    output: {
        path: path.join(__dirname, 'build'),
        filename: 'bundle.js',
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(js|jsx)$/,
                loader: 'babel-loader',
                include: path.join(__dirname, 'app'),
                exclude: /node_modules/,
                query: {
                    presets: ['es2015', 'react']
                }
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin()
    ]
}