import '/flutter_flow/flutter_flow_autocomplete_options_list.dart';
import '/flutter_flow/flutter_flow_button_tabbar.dart';
import '/flutter_flow/flutter_flow_icon_button.dart';
import '/flutter_flow/flutter_flow_theme.dart';
import '/flutter_flow/flutter_flow_util.dart';
import 'package:easy_debounce/easy_debounce.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'home_page_model.dart';
export 'home_page_model.dart';

class HomePageWidget extends StatefulWidget {
  const HomePageWidget({Key? key}) : super(key: key);

  @override
  _HomePageWidgetState createState() => _HomePageWidgetState();
}

class _HomePageWidgetState extends State<HomePageWidget> {
  late HomePageModel _model;

  final scaffoldKey = GlobalKey<ScaffoldState>();
  final _unfocusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _model = createModel(context, () => HomePageModel());

    _model.searchFieldController ??= TextEditingController();
  }

  @override
  void dispose() {
    _model.dispose();

    _unfocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => FocusScope.of(context).requestFocus(_unfocusNode),
      child: WillPopScope(
        onWillPop: () async => false,
        child: Scaffold(
          key: scaffoldKey,
          backgroundColor: FlutterFlowTheme.of(context).accent3,
          endDrawer: Drawer(
            elevation: 16.0,
            child: DefaultTabController(
              length: 5,
              initialIndex: 0,
              child: Column(
                children: [
                  Expanded(
                    child: TabBarView(
                      children: [
                        Column(
                          mainAxisSize: MainAxisSize.max,
                          children: [
                            Padding(
                              padding: EdgeInsetsDirectional.fromSTEB(
                                  0.0, 5.0, 0.0, 0.0),
                              child: FlutterFlowIconButton(
                                borderColor: Color(0xFF8B8B8B),
                                borderRadius: 15.0,
                                borderWidth: 1.0,
                                buttonSize: 50.0,
                                fillColor: Color(0xFF2E2E2E),
                                icon: Icon(
                                  Icons.add_box,
                                  color: Color(0xFFB9B9B9),
                                  size: 24.0,
                                ),
                                onPressed: () {
                                  print('AddTabButton pressed ...');
                                },
                              ),
                            ),
                            Divider(
                              thickness: 1.0,
                              color: FlutterFlowTheme.of(context).accent4,
                            ),
                            ListView(
                              padding: EdgeInsets.zero,
                              shrinkWrap: true,
                              scrollDirection: Axis.vertical,
                              children: [],
                            ),
                          ],
                        ),
                        Column(
                          mainAxisSize: MainAxisSize.max,
                          children: [
                            Padding(
                              padding: EdgeInsetsDirectional.fromSTEB(
                                  0.0, 5.0, 0.0, 0.0),
                              child: FlutterFlowIconButton(
                                borderColor: Color(0xFF8B8B8B),
                                borderRadius: 15.0,
                                borderWidth: 1.0,
                                buttonSize: 50.0,
                                fillColor: Color(0xFF2E2E2E),
                                icon: Icon(
                                  Icons.cleaning_services,
                                  color: Color(0xFFB9B9B9),
                                  size: 24.0,
                                ),
                                onPressed: () {
                                  print('CleanHistoryButton pressed ...');
                                },
                              ),
                            ),
                            Divider(
                              thickness: 1.0,
                              color: FlutterFlowTheme.of(context).accent4,
                            ),
                            ListView(
                              padding: EdgeInsets.zero,
                              shrinkWrap: true,
                              scrollDirection: Axis.vertical,
                              children: [],
                            ),
                          ],
                        ),
                        ListView(
                          padding: EdgeInsets.zero,
                          scrollDirection: Axis.vertical,
                          children: [],
                        ),
                        ListView(
                          padding: EdgeInsets.zero,
                          scrollDirection: Axis.vertical,
                          children: [],
                        ),
                        Column(
                          mainAxisSize: MainAxisSize.max,
                          children: [
                            Padding(
                              padding: EdgeInsetsDirectional.fromSTEB(
                                  0.0, 5.0, 0.0, 0.0),
                              child: FlutterFlowIconButton(
                                borderColor: Color(0xFF8B8B8B),
                                borderRadius: 15.0,
                                borderWidth: 1.0,
                                buttonSize: 50.0,
                                fillColor: Color(0xFF2E2E2E),
                                icon: Icon(
                                  Icons.cleaning_services,
                                  color: Color(0xFFB9B9B9),
                                  size: 24.0,
                                ),
                                onPressed: () {
                                  print('CleanDownloadButton pressed ...');
                                },
                              ),
                            ),
                            Divider(
                              thickness: 1.0,
                              color: FlutterFlowTheme.of(context).accent4,
                            ),
                            ListView(
                              padding: EdgeInsets.zero,
                              shrinkWrap: true,
                              scrollDirection: Axis.vertical,
                              children: [],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Align(
                    alignment: Alignment(0.0, 0),
                    child: FlutterFlowButtonTabBar(
                      useToggleButtonStyle: true,
                      labelStyle: FlutterFlowTheme.of(context).titleMedium,
                      unselectedLabelStyle:
                          FlutterFlowTheme.of(context).titleMedium,
                      labelColor: Color(0xFF2E2E2E),
                      unselectedLabelColor: Color(0xFFB9B9B9),
                      backgroundColor: Color(0xFFB9B9B9),
                      unselectedBackgroundColor: Color(0xFF2E2E2E),
                      borderColor: Color(0xFF8B8B8B),
                      unselectedBorderColor: Color(0xFF8B8B8B),
                      borderWidth: 2.0,
                      borderRadius: 5.0,
                      elevation: 0.0,
                      buttonMargin:
                          EdgeInsetsDirectional.fromSTEB(8.0, 0.0, 8.0, 0.0),
                      padding:
                          EdgeInsetsDirectional.fromSTEB(4.0, 4.0, 4.0, 4.0),
                      tabs: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.tab,
                            ),
                            Tab(),
                          ],
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.history,
                            ),
                            Tab(),
                          ],
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.star_rounded,
                            ),
                            Tab(),
                          ],
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.settings,
                            ),
                            Tab(),
                          ],
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.download_rounded,
                            ),
                            Tab(),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          appBar: AppBar(
            backgroundColor: Color(0xFF2E2E2E),
            automaticallyImplyLeading: true,
            leading: FlutterFlowIconButton(
              borderColor: Colors.transparent,
              borderRadius: 30.0,
              borderWidth: 1.0,
              buttonSize: 60.0,
              icon: Icon(
                Icons.replay_sharp,
                color: Color(0xFFB9B9B9),
                size: 30.0,
              ),
              onPressed: () {
                print('ReloadButton pressed ...');
              },
            ),
            title: Autocomplete<String>(
              initialValue: TextEditingValue(),
              optionsBuilder: (textEditingValue) {
                if (textEditingValue.text == '') {
                  return const Iterable<String>.empty();
                }
                return ['Option 1'].where((option) {
                  final lowercaseOption = option.toLowerCase();
                  return lowercaseOption
                      .contains(textEditingValue.text.toLowerCase());
                });
              },
              optionsViewBuilder: (context, onSelected, options) {
                return AutocompleteOptionsList(
                  textFieldKey: _model.searchFieldKey,
                  textController: _model.searchFieldController!,
                  options: options.toList(),
                  onSelected: onSelected,
                  textStyle: FlutterFlowTheme.of(context).bodyMedium,
                  textHighlightStyle: TextStyle(),
                  elevation: 4.0,
                  optionBackgroundColor:
                      FlutterFlowTheme.of(context).primaryBackground,
                  optionHighlightColor:
                      FlutterFlowTheme.of(context).secondaryBackground,
                  maxHeight: 200.0,
                );
              },
              onSelected: (String selection) {
                setState(() => _model.searchFieldSelectedOption = selection);
                FocusScope.of(context).unfocus();
              },
              fieldViewBuilder: (
                context,
                textEditingController,
                focusNode,
                onEditingComplete,
              ) {
                _model.searchFieldController = textEditingController;
                return TextFormField(
                  key: _model.searchFieldKey,
                  controller: textEditingController,
                  focusNode: focusNode,
                  onEditingComplete: onEditingComplete,
                  onChanged: (_) => EasyDebounce.debounce(
                    '_model.searchFieldController',
                    Duration(milliseconds: 2000),
                    () => setState(() {}),
                  ),
                  autofocus: true,
                  obscureText: false,
                  decoration: InputDecoration(
                    hintText: 'Search',
                    hintStyle:
                        FlutterFlowTheme.of(context).titleMedium.override(
                              fontFamily: 'Poppins',
                              color: Color(0xFF454545),
                            ),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFE8E8E8),
                        width: 1.0,
                      ),
                      borderRadius: BorderRadius.circular(10.0),
                    ),
                    focusedBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFF5C5C5C),
                        width: 1.0,
                      ),
                      borderRadius: BorderRadius.circular(10.0),
                    ),
                    errorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1.0,
                      ),
                      borderRadius: BorderRadius.circular(10.0),
                    ),
                    focusedErrorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1.0,
                      ),
                      borderRadius: BorderRadius.circular(10.0),
                    ),
                    filled: true,
                    fillColor: Color(0xFFB9B9B9),
                    suffixIcon: Icon(
                      Icons.http,
                      color: Color(0xFF454545),
                    ),
                  ),
                  style: FlutterFlowTheme.of(context).labelMedium.override(
                        fontFamily: 'Poppins',
                        color: Color(0xFF454545),
                      ),
                  textAlign: TextAlign.start,
                  validator: _model.searchFieldControllerValidator
                      .asValidator(context),
                );
              },
            ),
            actions: [
              Row(
                mainAxisSize: MainAxisSize.max,
                children: [
                  FlutterFlowIconButton(
                    borderRadius: 20.0,
                    borderWidth: 1.0,
                    buttonSize: 40.0,
                    icon: Icon(
                      Icons.star_outline_rounded,
                      color: Color(0xFFB9B9B9),
                      size: 24.0,
                    ),
                    onPressed: () {
                      print('PreferedButton pressed ...');
                    },
                  ),
                  FlutterFlowIconButton(
                    borderRadius: 20.0,
                    borderWidth: 1.0,
                    buttonSize: 40.0,
                    icon: Icon(
                      Icons.menu,
                      color: Color(0xFFB9B9B9),
                      size: 24.0,
                    ),
                    onPressed: () {
                      print('MenuButton pressed ...');
                    },
                  ),
                ],
              ),
            ],
            centerTitle: true,
            elevation: 4.0,
          ),
          body: SafeArea(
            top: true,
            child: ListView(
              padding: EdgeInsets.zero,
              scrollDirection: Axis.vertical,
              children: [],
            ),
          ),
        ),
      ),
    );
  }
}
